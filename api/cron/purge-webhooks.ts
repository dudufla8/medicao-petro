import { constantTimeEqual, sendJson } from '../_lib/auth.js';
import { ensureSchema, getSql, type SqlClient } from '../_lib/db.js';

/**
 * Job Diário (Vercel Cron):
 * - Protegido por CRON_SECRET (Header Authorization: Bearer <CRON_SECRET> ou X-Cron-Secret).
 * - Faz expurgo do payload bruto (JSONB) de webhook_events com mais de WEBHOOK_RETENTION_DAYS (padrão 180 dias).
 * - Limpa cache temporário de rides com mais de 7 dias.
 * - NUNCA apaga ride_final_data, justifications nem audit_log.
 */
export async function handlePurgeCronRequest(
  req: any,
  res: any,
  customSql?: SqlClient
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    sendJson(res, 500, { ok: false, error: 'CRON_SECRET não configurado no servidor.' });
    return;
  }

  const authHeader = Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
  const xCronHeader = Array.isArray(req.headers?.['x-cron-secret'])
    ? req.headers['x-cron-secret'][0]
    : req.headers?.['x-cron-secret'] || '';

  const provided = bearerToken || String(xCronHeader);
  if (!provided || !constantTimeEqual(provided, cronSecret)) {
    sendJson(res, 401, { ok: false, error: 'Não autorizado.' });
    return;
  }

  const retentionDays = Math.max(
    30,
    Number(process.env.WEBHOOK_RETENTION_DAYS || 180) || 180
  );

  try {
    const sql = customSql || getSql();
    await ensureSchema(sql);

    // 1. Limpa APENAS o payload bruto de webhook_events > retentionDays (preservando metadados e jamais tocando ride_final_data, justifications ou audit_log)
    const purgedPayloads = (await sql`
      UPDATE webhook_events
      SET payload = NULL, payload_purged_at = NOW()
      WHERE payload IS NOT NULL
        AND received_at < NOW() - (${retentionDays} * INTERVAL '1 day')
      RETURNING id
    `) as Array<{ id: number }>;

    // 2. Remove eventos de teste (booking_id = '999999999') com mais de 1 dia
    await sql`
      DELETE FROM webhook_events
      WHERE booking_id = '999999999'
        AND received_at < NOW() - INTERVAL '1 day'
    `;

    // 3. Limpa cache efêmero de rides (TTL curto de 7 dias)
    const expiredCache = (await sql`
      DELETE FROM rides
      WHERE cached_at < NOW() - INTERVAL '7 days'
      RETURNING booking_id
    `) as Array<{ booking_id: string }>;

    sendJson(res, 200, {
      ok: true,
      retentionDays,
      purgedWebhookPayloadsCount: purgedPayloads.length,
      expiredRidesCacheRemoved: expiredCache.length
    });
  } catch {
    sendJson(res, 500, { ok: false, error: 'Erro ao executar expurgo LGPD.' });
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  await handlePurgeCronRequest(req, res);
}
