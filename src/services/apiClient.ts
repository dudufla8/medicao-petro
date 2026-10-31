const SESSION_TOKEN_STORAGE_KEY = 'tx20_session_token';
const SESSION_OPERATOR_STORAGE_KEY = 'tx20_operator_name';

let inMemoryToken: string | null = null;

export function getStoredSessionToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    return sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSession(token: string | null, operatorName?: string): void {
  inMemoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
      if (operatorName) {
        sessionStorage.setItem(SESSION_OPERATOR_STORAGE_KEY, operatorName);
      }
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_OPERATOR_STORAGE_KEY);
    }
  } catch {
    // Ignora caso sessionStorage esteja indisponível em modo restrito
  }
}

export function getStoredOperatorName(): string {
  try {
    return sessionStorage.getItem(SESSION_OPERATOR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra || {})
  };
  const token = getStoredSessionToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface SessionInfo {
  authenticated: boolean;
  operatorName?: string;
  exp?: number;
}

export async function checkSession(): Promise<SessionInfo> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: buildAuthHeaders()
    });
    if (!res.ok) {
      return { authenticated: false };
    }
    const data = await res.json();
    return {
      authenticated: Boolean(data.authenticated),
      operatorName: data.operatorName,
      exp: data.exp
    };
  } catch {
    return { authenticated: false };
  }
}

export async function loginWithPassword(
  operatorName: string,
  password: string
): Promise<{ ok: boolean; operatorName?: string; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorName, password })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || 'Credenciais inválidas ou acesso temporariamente bloqueado.'
    };
  }

  setStoredSession(data.token || null, data.operatorName || operatorName);
  return {
    ok: true,
    operatorName: data.operatorName || operatorName
  };
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'include',
      headers: buildAuthHeaders()
    });
  } finally {
    setStoredSession(null);
  }
}

export interface WebhookEventSummary {
  id: number;
  receivedAt: string;
  code: string;
  status: number | null;
  bookingId: string;
  hasDriverComment: boolean;
}

export interface WebhookDailyCounter {
  date: string;
  total: number;
  completed: number;
  withDriverComment: number;
}

export async function fetchWebhookEvents(): Promise<{
  events: WebhookEventSummary[];
  dailyCounters: WebhookDailyCounter[];
}> {
  const res = await fetch('/api/taxidigital/webhook-events', {
    method: 'GET',
    credentials: 'include',
    headers: buildAuthHeaders()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Erro ${res.status} ao carregar eventos do webhook.`);
  }

  return {
    events: Array.isArray(data.events) ? data.events : [],
    dailyCounters: Array.isArray(data.dailyCounters) ? data.dailyCounters : []
  };
}
