import crypto from 'node:crypto';
import {
  sanitizeWebhookPayload,
  TdWebhookPayloadSchema
} from '../../src/domain/parsers';
import { adaptWebhookCompletedToFinalData } from '../../src/domain/ride';
import { constantTimeEqual, sendJson } from '../_lib/auth';
import { ensureSchema, getSql, type SqlClient } from '../_lib/db';

async function readRawBody(req: any): Promise<string> {
  if (typeof req.rawBody === 'string') {
    return req.rawBody;
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }
  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export async function handleWebhookRequest(
  req: any,
  res: any,
  customSql?: SqlClient
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (!expectedSecret) {
    sendJson(res, 500, { ok: false, error: 'Configuração de webhook ausente no servidor.' });
    return;
  }

  // 1. Validação do header X-Webhook-Secret em tempo constante ANTES de processar o corpo
  const rawHeader =
    req.headers?.['x-webhook-secret'] ??
    req.headers?.['X-Webhook-Secret'];
  const providedSecret = Array.isArray(rawHeader)
    ? rawHeader[0]
    : typeof rawHeader === 'string'
      ? rawHeader
      : '';

  if (!providedSecret || !constantTimeEqual(providedSecret, expectedSecret)) {
    sendJson(res, 401, { ok: false, error: 'Não autorizado.' });
    return;
  }

  // 2. Leitura e parse do corpo bruto + cálculo da chave de idempotência SHA-256
  let rawBodyStr = '';
  let jsonBody: unknown;
  try {
    rawBodyStr = await readRawBody(req);
    jsonBody =
      req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(rawBodyStr || '{}');
  } catch {
    sendJson(res, 400, { ok: false, error: 'JSON inválido no corpo da requisição.' });
    return;
  }

  const parsed = TdWebhookPayloadSchema.safeParse(jsonBody);
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: 'Formato de payload inválido.' });
    return;
  }

  const event = parsed.data;
  const eventType = String(event.type || '').toLowerCase();

  // 3. Eventos de posição: responder 200 imediatamente e NÃO armazenar nada (LGPD)
  if (eventType === 'position') {
    sendJson(res, 200, {
      ok: true,
      ignored: true,
      reason: 'position_event'
    });
    return;
  }

  if (eventType !== 'status') {
    sendJson(res, 200, {
      ok: true,
      ignored: true,
      reason: 'unsupported_event_type'
    });
    return;
  }

  // 4. Evento de status: grava em webhook_events (idempotente por SHA-256) e upsert em ride_final_data no status 5 / completed
  const payloadHash = crypto
    .createHash('sha256')
    .update(rawBodyStr || JSON.stringify(jsonBody), 'utf8')
    .digest('hex');

  const receivedAtIso = new Date().toISOString();
  const sanitizedPayload = sanitizeWebhookPayload(jsonBody);
  const code = String(event.code || '').trim();
  const statusNum = typeof event.status === 'number' && Number.isFinite(event.status) ? event.status : null;
  const bookingId = String(event.booking_id || '').trim();
  const externalAuthId = String(event.external_authorization_id || '').trim();
  const apiVersion = String(event.api_version || '').trim();
  const driverComment = String(event.driver_comment || '').trim();
  const hasDriverComment = driverComment.length > 0;

  try {
    const sql = customSql || getSql();
    await ensureSchema(sql);

    const insertedRows = (await sql`
      INSERT INTO webhook_events (
        payload_hash,
        received_at,
        type,
        code,
        status,
        booking_id,
        external_authorization_id,
        api_version,
        has_driver_comment,
        payload
      )
      VALUES (
        ${payloadHash},
        ${receivedAtIso},
        'status',
        ${code},
        ${statusNum},
        ${bookingId},
        ${externalAuthId},
        ${apiVersion},
        ${hasDriverComment},
        ${JSON.stringify(sanitizedPayload)}::jsonb
      )
      ON CONFLICT (payload_hash) DO NOTHING
      RETURNING id
    `) as Array<{ id: number }>;

    const isDuplicate = insertedRows.length === 0;

    // Se for code "completed" (ou status 5), fazemos upsert em ride_final_data (apenas se received_at for mais recente)
    const finalData = adaptWebhookCompletedToFinalData(event, receivedAtIso);
    if (finalData && !isDuplicate) {
      await sql`
        INSERT INTO ride_final_data (
          booking_id,
          ride_value,
          service_value,
          stopped_time_seconds,
          stopped_time_value,
          toll_value,
          parking_value,
          discount_value,
          km,
          time_in_seconds,
          driver_comment,
          category_id,
          source,
          received_at,
          updated_at
        )
        VALUES (
          ${finalData.bookingId},
          ${finalData.rideValue},
          ${finalData.serviceValue},
          ${finalData.stoppedTimeSeconds},
          ${finalData.stoppedTimeValue},
          ${finalData.tollValue},
          ${finalData.parkingValue},
          ${finalData.discountValue},
          ${finalData.km},
          ${finalData.timeInSeconds},
          ${finalData.driverComment},
          ${finalData.categoryId},
          'webhook',
          ${receivedAtIso},
          NOW()
        )
        ON CONFLICT (booking_id) DO UPDATE SET
          ride_value = EXCLUDED.ride_value,
          service_value = EXCLUDED.service_value,
          stopped_time_seconds = EXCLUDED.stopped_time_seconds,
          stopped_time_value = EXCLUDED.stopped_time_value,
          toll_value = EXCLUDED.toll_value,
          parking_value = EXCLUDED.parking_value,
          discount_value = EXCLUDED.discount_value,
          km = EXCLUDED.km,
          time_in_seconds = EXCLUDED.time_in_seconds,
          driver_comment = CASE
            WHEN EXCLUDED.driver_comment <> '' THEN EXCLUDED.driver_comment
            ELSE ride_final_data.driver_comment
          END,
          category_id = EXCLUDED.category_id,
          source = 'webhook',
          received_at = EXCLUDED.received_at,
          updated_at = NOW()
        WHERE ride_final_data.received_at <= EXCLUDED.received_at
      `;
    }

    sendJson(res, 200, {
      ok: true,
      idempotentDuplicate: isDuplicate,
      receivedAt: receivedAtIso
    });
  } catch {
    sendJson(res, 500, { ok: false, error: 'Erro ao gravar evento do webhook.' });
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  await handleWebhookRequest(req, res);
}
