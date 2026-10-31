import { z } from 'zod';
import {
  buildSessionCookieHeader,
  constantTimeEqual,
  createSessionToken,
  getClientIpHash,
  sendJson
} from '../_lib/auth';
import { ensureSchema, getSql, type SqlClient } from '../_lib/db';

const LoginBodySchema = z.object({
  password: z.string().min(1),
  operatorName: z.string().trim().min(2).max(80)
});

const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;
const GENERIC_AUTH_ERROR = 'Credenciais inválidas ou acesso temporariamente bloqueado.';

export async function handleLoginRequest(
  req: any,
  res: any,
  customSql?: SqlClient
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const expectedPass = process.env.APP_ACCESS_PASSWORD;
  if (!expectedPass) {
    sendJson(res, 500, { ok: false, error: 'Configuração de segurança ausente no servidor.' });
    return;
  }

  let bodyObj: unknown = req.body;
  if (typeof bodyObj === 'string') {
    try {
      bodyObj = JSON.parse(bodyObj);
    } catch {
      sendJson(res, 400, { ok: false, error: GENERIC_AUTH_ERROR });
      return;
    }
  }

  const parsed = LoginBodySchema.safeParse(bodyObj);
  if (!parsed.success) {
    sendJson(res, 400, {
      ok: false,
      error: 'Informe o nome do operador (mín. 2 caracteres) e a senha de acesso.'
    });
    return;
  }

  const { password, operatorName } = parsed.data;
  const ipHash = getClientIpHash(req);

  try {
    const sql = customSql || getSql();
    await ensureSchema(sql);

    // 1. Verifica bloqueio por IP (rate limit no banco)
    const rows = (await sql`
      SELECT attempts, first_attempt_at, locked_until
      FROM login_attempts
      WHERE ip_hash = ${ipHash}
      LIMIT 1
    `) as Array<{ attempts: number; first_attempt_at: string; locked_until: string | null }>;

    const now = new Date();
    const record = rows[0];
    if (record?.locked_until && new Date(record.locked_until) > now) {
      sendJson(res, 401, { ok: false, error: GENERIC_AUTH_ERROR });
      return;
    }

    // 2. Compara senha em tempo constante
    const isValid = constantTimeEqual(password, expectedPass);

    if (!isValid) {
      const nextAttempts = record ? Number(record.attempts) + 1 : 1;
      const shouldLock = nextAttempts >= MAX_ATTEMPTS;
      const lockedUntilIso = shouldLock
        ? new Date(now.getTime() + LOCK_WINDOW_MINUTES * 60 * 1000).toISOString()
        : null;

      await sql`
        INSERT INTO login_attempts (ip_hash, attempts, first_attempt_at, locked_until)
        VALUES (${ipHash}, ${nextAttempts}, NOW(), ${lockedUntilIso})
        ON CONFLICT (ip_hash) DO UPDATE SET
          attempts = ${nextAttempts},
          locked_until = ${lockedUntilIso}
      `;

      sendJson(res, 401, { ok: false, error: GENERIC_AUTH_ERROR });
      return;
    }

    // 3. Sucesso: limpa tentativas do IP e registra login no audit_log
    await sql`
      DELETE FROM login_attempts WHERE ip_hash = ${ipHash}
    `;

    await sql`
      INSERT INTO audit_log (action, target_key, previous_status, new_status, operator_name)
      VALUES ('LOGIN_SUCCESS', 'session', NULL, 'authenticated', ${operatorName})
    `;

    const token = createSessionToken(operatorName);
    const hostHeader = Array.isArray(req.headers?.host) ? req.headers.host[0] : req.headers?.host;
    res.setHeader('Set-Cookie', buildSessionCookieHeader(token, hostHeader));

    sendJson(res, 200, {
      ok: true,
      operatorName,
      token
    });
  } catch {
    sendJson(res, 500, { ok: false, error: 'Erro interno ao processar autenticação.' });
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  await handleLoginRequest(req, res);
}
