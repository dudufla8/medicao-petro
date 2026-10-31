import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const SESSION_COOKIE_NAME = 'tx20_medicao_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 horas

export interface SessionPayload {
  operatorName: string;
  iat: number;
  exp: number;
}

/**
 * Comparação em tempo constante usando SHA-256 + crypto.timingSafeEqual
 * (Evita vazamento de tamanho ou conteúdo do segredo).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB) && a.length === b.length;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error('Variável SESSION_SECRET ausente ou muito curta (mínimo 16 caracteres).');
  }
  return secret.trim();
}

/**
 * Cria token assinado HMAC-SHA256 com dados do operador e expiração
 */
export function createSessionToken(operatorName: string): string {
  const secret = getSessionSecret();
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    operatorName: operatorName.trim().slice(0, 80) || 'Operador',
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64, 'utf8')
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verifica assinatura HMAC-SHA256 e validade temporal do token
 */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, providedSig] = parts;
  if (!payloadB64 || !providedSig) return null;

  try {
    const secret = getSessionSecret();
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payloadB64, 'utf8')
      .digest('base64url');

    if (!constantTimeEqual(providedSig, expectedSig)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp < nowSec) {
      return null;
    }

    return {
      operatorName: String(decoded.operatorName || 'Operador'),
      iat: decoded.iat,
      exp: decoded.exp
    };
  } catch {
    return null;
  }
}

/**
 * Monta o cabeçalho Set-Cookie adaptando automaticamente:
 * - Se o host for *.taxidoispontozero.com.br (CNAME mesmo site): SameSite=Lax; Domain=.taxidoispontozero.com.br; Secure; HttpOnly
 * - Se o host for localhost: SameSite=Lax; HttpOnly
 * - Se o host for *.vercel.app (iframe cross-domain): SameSite=None; Secure; HttpOnly; Partitioned
 */
export function buildSessionCookieHeader(token: string, hostHeader?: string): string {
  const host = String(hostHeader || '').toLowerCase().split(':')[0];
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isSameSiteDomain =
    host === 'taxidoispontozero.com.br' || host.endsWith('.taxidoispontozero.com.br');

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];

  if (isLocal) {
    parts.push('SameSite=Lax');
  } else if (isSameSiteDomain) {
    parts.push('Secure');
    parts.push('SameSite=Lax');
    parts.push('Domain=.taxidoispontozero.com.br');
  } else {
    parts.push('Secure');
    parts.push('SameSite=None');
    parts.push('Partitioned');
  }

  return parts.join('; ');
}

export function buildLogoutCookieHeader(hostHeader?: string): string {
  const host = String(hostHeader || '').toLowerCase().split(':')[0];
  const isSameSiteDomain =
    host === 'taxidoispontozero.com.br' || host.endsWith('.taxidoispontozero.com.br');
  const domainPart = isSameSiteDomain ? '; Domain=.taxidoispontozero.com.br' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0${domainPart}`;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Extrai e valida a sessão de uma requisição HTTP (Cookie httpOnly OU Header Authorization Bearer).
 */
export function getAuthenticatedSession(req: IncomingMessage & { headers: Record<string, string | string[] | undefined> }): SessionPayload | null {
  // 1. Verifica Cookie httpOnly
  const cookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join('; ')
    : req.headers.cookie;
  const cookies = parseCookies(cookieHeader);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const verified = verifySessionToken(cookieToken);
    if (verified) return verified;
  }

  // 2. Fallback para Header Authorization: Bearer <token> (necessário para iframe cross-domain restrito)
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    const verified = verifySessionToken(bearerToken);
    if (verified) return verified;
  }

  return null;
}

/**
 * Helper que exige autenticação em rotas /api/* (retorna null e responde 401 se não autenticado).
 */
export function requireAuth(
  req: IncomingMessage & { headers: Record<string, string | string[] | undefined> },
  res: ServerResponse & { status?: (code: number) => any; json?: (body: any) => any }
): SessionPayload | null {
  const session = getAuthenticatedSession(req);
  if (!session) {
    sendJson(res, 401, {
      ok: false,
      error: 'Não autorizado. Faça login para acessar este recurso.'
    });
    return null;
  }
  return session;
}

/**
 * Helper universal para enviar JSON compatível tanto com VercelRequest/VercelResponse quanto com Node http.ServerResponse
 */
export function sendJson(res: ServerResponse & { status?: (code: number) => any; json?: (body: any) => any }, statusCode: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(body);
    return;
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

/**
 * Calcula hash SHA-256 do IP do cliente para rate limiting sem armazenar o IP puro (LGPD).
 */
export function getClientIpHash(req: IncomingMessage & { headers: Record<string, string | string[] | undefined> }): string {
  const xff = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(xff)
    ? xff[0]
    : typeof xff === 'string'
      ? xff.split(',')[0].trim()
      : req.socket?.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`ip_salt_tx20:${rawIp}`, 'utf8').digest('hex');
}
