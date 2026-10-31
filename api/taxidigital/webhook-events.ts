import { requireAuth, sendJson } from '../_lib/auth.js';
import { ensureSchema, getSql, type SqlClient } from '../_lib/db.js';

export async function handleWebhookEventsRequest(
  req: any,
  res: any,
  customSql?: SqlClient
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const sql = customSql || getSql();
    await ensureSchema(sql);

    // Últimos 50 eventos reais (ocultando booking_id = 999999999 de teste e sem nomes/telefones/placas)
    const events = await sql`
      SELECT
        id,
        received_at AS "receivedAt",
        code,
        status,
        booking_id AS "bookingId",
        has_driver_comment AS "hasDriverComment"
      FROM webhook_events
      WHERE booking_id <> '999999999'
      ORDER BY received_at DESC
      LIMIT 50
    `;

    // Contadores agregados por dia (fuso America/Sao_Paulo), também ocultando booking_id = 999999999
    const dailyCounters = await sql`
      SELECT
        TO_CHAR(received_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE code = 'completed' OR status = 5)::int AS "completed",
        COUNT(*) FILTER (WHERE has_driver_comment = TRUE)::int AS "withDriverComment"
      FROM webhook_events
      WHERE booking_id <> '999999999'
      GROUP BY 1, DATE_TRUNC('day', received_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY DATE_TRUNC('day', received_at AT TIME ZONE 'America/Sao_Paulo') DESC
      LIMIT 30
    `;

    sendJson(res, 200, {
      ok: true,
      events,
      dailyCounters
    });
  } catch {
    sendJson(res, 500, {
      ok: false,
      error: 'Erro ao consultar eventos do webhook.'
    });
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  await handleWebhookEventsRequest(req, res);
}
