import { beforeEach, describe, expect, it } from 'vitest';
import { resetSchemaCacheForTests } from '../../../api/_lib/db';
import { handleWebhookRequest } from '../../../api/taxidigital/webhook';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    end(str: string) {
      try {
        this.body = JSON.parse(str);
      } catch {
        this.body = str;
      }
    }
  };
  return res;
}

describe('Endpoint POST /api/taxidigital/webhook', () => {
  const TEST_SECRET = 'segredo_super_seguro_webhook_12345';

  beforeEach(() => {
    process.env.WEBHOOK_SECRET = TEST_SECRET;
    resetSchemaCacheForTests();
  });

  it('(a) aceita evento status 5 com X-Webhook-Secret correto (200) e faz upsert em ride_final_data', async () => {
    const queries: string[] = [];
    const seenHashes = new Set<string>();

    const mockSql: any = async (strings: TemplateStringsArray, ...values: any[]) => {
      const q = strings.join(' ');
      queries.push(q);
      if (q.includes('INSERT INTO webhook_events')) {
        const hash = values[0];
        if (seenHashes.has(hash)) return [];
        seenHashes.add(hash);
        return [{ id: 1 }];
      }
      return [];
    };

    const payload = {
      type: 'status',
      code: 'completed',
      status: 5,
      booking_id: '999999999',
      amount: 85.4,
      stopped_time: 180,
      stopped_time_value: 4.5,
      toll_value: 0,
      parking_value: 0,
      discount_value: 0,
      driver_comment: 'Teste automatizado',
      km: 18.45,
      time: 1420
    };

    const req1 = {
      method: 'POST',
      headers: { 'x-webhook-secret': TEST_SECRET },
      body: payload,
      rawBody: JSON.stringify(payload)
    };
    const res1 = createMockRes();
    await handleWebhookRequest(req1, res1, mockSql);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.idempotentDuplicate).toBe(false);
    expect(queries.some(q => q.includes('INSERT INTO webhook_events'))).toBe(true);
    expect(queries.some(q => q.includes('INSERT INTO ride_final_data'))).toBe(true);

    // Verifica idempotência enviando o mesmo corpo novamente
    const res2 = createMockRes();
    await handleWebhookRequest(req1, res2, mockSql);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.idempotentDuplicate).toBe(true);
  });

  it('(b) rejeita com 401 quando X-Webhook-Secret está errado sem tocar no banco', async () => {
    let dbCalled = false;
    const mockSql: any = async () => {
      dbCalled = true;
      return [];
    };

    const req = {
      method: 'POST',
      headers: { 'x-webhook-secret': 'chave_incorreta' },
      body: { type: 'status', code: 'completed', status: 5, booking_id: '999999999' }
    };
    const res = createMockRes();
    await handleWebhookRequest(req, res, mockSql);

    expect(res.statusCode).toBe(401);
    expect(dbCalled).toBe(false);
  });

  it('(c) rejeita com 401 quando o header X-Webhook-Secret está ausente', async () => {
    let dbCalled = false;
    const mockSql: any = async () => {
      dbCalled = true;
      return [];
    };

    const req = {
      method: 'POST',
      headers: {},
      body: { type: 'status', code: 'completed', status: 5, booking_id: '999999999' }
    };
    const res = createMockRes();
    await handleWebhookRequest(req, res, mockSql);

    expect(res.statusCode).toBe(401);
    expect(dbCalled).toBe(false);
  });

  it('(d) responde 200 para evento type=position e NÃO grava nada no banco', async () => {
    let dbCalled = false;
    const mockSql: any = async () => {
      dbCalled = true;
      return [];
    };

    const req = {
      method: 'POST',
      headers: { 'x-webhook-secret': TEST_SECRET },
      body: {
        type: 'position',
        latitude: '-22.906847',
        longitude: '-43.172896',
        speed: 40,
        angle: 90,
        booking_id: '999999999'
      }
    };
    const res = createMockRes();
    await handleWebhookRequest(req, res, mockSql);

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(res.body.reason).toBe('position_event');
    expect(dbCalled).toBe(false);
  });
});
