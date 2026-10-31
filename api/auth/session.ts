import {
  buildLogoutCookieHeader,
  getAuthenticatedSession,
  sendJson
} from '../_lib/auth.js';

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === 'DELETE' || req.method === 'POST') {
    const hostHeader = Array.isArray(req.headers?.host) ? req.headers.host[0] : req.headers?.host;
    res.setHeader('Set-Cookie', buildLogoutCookieHeader(hostHeader));
    sendJson(res, 200, { ok: true, authenticated: false });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const session = getAuthenticatedSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, authenticated: false });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    authenticated: true,
    operatorName: session.operatorName,
    exp: session.exp
  });
}
