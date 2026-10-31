import { z } from 'zod';

/**
 * Fuso horário oficial das operações: America/Sao_Paulo (UTC-3)
 */
export const SAO_PAULO_OFFSET = '-03:00';

/**
 * Converte número do Relatório Táxi Digital (/api/booking/report/json).
 * No relatório, o separador decimal é PONTO (ex: "93.98", "23.000" -> 23 km).
 * Nunca trata ponto ou vírgula como separador de milhar.
 */
export function parseReportNumber(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val !== 'string') return 0;
  const clean = val.trim();
  if (!clean) return 0;
  const normalized = clean.replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Converte número do Detalhes Táxi Digital (/api/booking/details/json).
 * No details, o separador decimal é VÍRGULA (ex: "53,76" -> 53.76, "21,795" -> 21.795 km).
 * Nunca trata vírgula como separador de milhar.
 */
export function parseDetailsNumber(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val !== 'string') return 0;
  const clean = val.trim();
  if (!clean) return 0;
  const normalized = clean.replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Converte número vindo do Webhook (pode vir como number ou string com ponto/vírgula).
 */
export function parseWebhookNumber(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val !== 'string') return 0;
  const clean = val.trim();
  if (!clean) return 0;
  const normalized = clean.replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Parser de data do Relatório (/api/booking/report/json):
 * Formato americano com relógio 12h: "M/d/yyyy h:mm:ss AM/PM" (ex: "9/1/2018 10:02:29 AM").
 * Considera fuso America/Sao_Paulo (-03:00).
 * Retorna ISO string em UTC ou null se inválida.
 */
export function parseReportDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (!clean) return null;

  // Formato M/d/yyyy h:mm:ss AM/PM (ou sem segundos)
  const usMatch = clean.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i
  );
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    let hour = Number(usMatch[4]);
    const minute = Number(usMatch[5]);
    const second = usMatch[6] ? Number(usMatch[6]) : 0;
    const ampm = usMatch[7]?.toUpperCase();

    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }

    const isoLocal = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${SAO_PAULO_OFFSET}`;
    const d = new Date(isoLocal);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * Parser de data do Details (/api/booking/details/json):
 * Formato brasileiro 24h: "dd/MM/yyyy HH:mm:ss" (ex: "01/09/2018 11:39:59").
 * Considera fuso America/Sao_Paulo (-03:00).
 */
export function parseDetailsDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (!clean) return null;

  const brMatch = clean.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    const hour = Number(brMatch[4]);
    const minute = Number(brMatch[5]);
    const second = brMatch[6] ? Number(brMatch[6]) : 0;

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }

    const isoLocal = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${SAO_PAULO_OFFSET}`;
    const d = new Date(isoLocal);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * Formata uma data ("yyyy-MM-dd" ou Date) para o formato exigido na requisição da Táxi Digital:
 * "dd/MM/yyyy HH:mm:ss"
 */
export function formatTdRequestDate(dateInput: string | Date, isEndOfDay = false): string {
  if (typeof dateInput === 'string') {
    const clean = dateInput.trim();
    // Se já estiver em dd/MM/yyyy HH:mm:ss
    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/.test(clean)) {
      return clean;
    }
    // Se estiver em yyyy-MM-dd
    const ymd = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const timePart = isEndOfDay ? '23:59:59' : '00:00:00';
      return `${ymd[3]}/${ymd[2]}/${ymd[1]} ${timePart}`;
    }
  }

  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Data inválida para requisição Táxi Digital: ${String(dateInput)}`);
  }

  // Formata no fuso America/Sao_Paulo
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Converte stopped_time para segundos:
 * - No webhook: vem em segundos (ex: 287 ou "287")
 * - No details: vem em "HH:MM:SS" (ex: "00:04:47")
 */
export function parseStoppedTimeToSeconds(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
  }
  if (typeof raw !== 'string') return 0;
  const clean = raw.trim();
  if (!clean) return 0;

  const hms = clean.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const s = hms[3] !== undefined ? Number(hms[3]) : 0;
    return h * 3600 + m * 60 + s;
  }

  const num = Number(clean.replace(',', '.'));
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
}

/**
 * Formata segundos em "HH:MM:SS" para exibição consistente
 */
export function formatSecondsToHMS(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ============================================================================
// SCHEMAS ZOD PERMISSIVOS PARA RESPOSTAS EXTERNAS DA TÁXI DIGITAL
// ============================================================================

const CoercedString = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
  .transform(v => (v === null || v === undefined ? '' : String(v).trim()));

export const TdEnvelopeSchema = z
  .object({
    status: z.union([z.number(), z.string()]).transform(v => Number(v)),
    data: z.unknown().optional(),
    message: CoercedString.optional(),
    status_code: z
      .union([z.number(), z.string()])
      .transform(v => Number(v))
      .optional(),
    code: CoercedString.optional()
  })
  .passthrough();

export const TdClientItemSchema = z
  .object({
    client_id: CoercedString,
    trade_name: CoercedString.optional(),
    company_name: CoercedString.optional(),
    cnpj: CoercedString.optional(),
    contract_number: CoercedString.optional()
  })
  .passthrough();

export const TdReportItemSchema = z
  .object({
    booking_id: CoercedString,
    service_id: CoercedString.optional(),
    register_date: CoercedString.optional(),
    schedule_date: CoercedString.optional(),
    local_date: CoercedString.optional(),
    start_date: CoercedString.optional(),
    end_date: CoercedString.optional(),
    source_name: CoercedString.optional(),
    user_name: CoercedString.optional(),
    requester_name: CoercedString.optional(),
    category_name: CoercedString.optional(),
    payment_name: CoercedString.optional(),
    init_address_name: CoercedString.optional(),
    init_address_number: CoercedString.optional(),
    init_reference: CoercedString.optional(),
    end_address_name: CoercedString.optional(),
    real_distance: CoercedString.optional(),
    real_fare: CoercedString.optional(),
    estimate_distance: CoercedString.optional(),
    estimate_fare: CoercedString.optional(),
    status_id: CoercedString.optional(),
    status_name: CoercedString.optional(),
    classifier1: CoercedString.optional(),
    classifier1_extra: CoercedString.optional(),
    classifier2: CoercedString.optional(),
    classifier2_extra: CoercedString.optional(),
    classifier3: CoercedString.optional(),
    classifier3_extra: CoercedString.optional(),
    classifier4: CoercedString.optional(),
    classifier4_extra: CoercedString.optional(),
    classifier5: CoercedString.optional(),
    classifier5_extra: CoercedString.optional(),
    taxi_company: CoercedString.optional(),
    taxi_prefix: CoercedString.optional(),
    taxi_driver: CoercedString.optional(),
    taxi_vehicle_brand: CoercedString.optional(),
    taxi_vehicle_model: CoercedString.optional(),
    taxi_vehicle_plate: CoercedString.optional(),
    taxi_vehicle_color: CoercedString.optional(),
    taxi_vehicle_model_year_: CoercedString.optional()
  })
  .passthrough();

export const TdDetailsDataSchema = z
  .object({
    date: CoercedString.optional(),
    passenger_name: CoercedString.optional(),
    payment_method: CoercedString.optional(),
    ride_value: CoercedString.optional(),
    service_value: CoercedString.optional(),
    stopped_time: CoercedString.optional(),
    stopped_time_value: CoercedString.optional(),
    tollgate_fare: CoercedString.optional(),
    parking_fare: CoercedString.optional(),
    discount_value: CoercedString.optional(),
    km: CoercedString.optional(),
    time_in_seconds: CoercedString.optional(),
    init_date: CoercedString.optional(),
    init_end: CoercedString.optional(),
    init_address: CoercedString.optional(),
    init_reference: CoercedString.optional(),
    end_address: CoercedString.optional(),
    driver_name: CoercedString.optional(),
    driver_prefix: CoercedString.optional(),
    license_plate: CoercedString.optional(),
    car_model: CoercedString.optional(),
    status_id: CoercedString.optional(),
    status_desc: CoercedString.optional(),
    category_id: CoercedString.optional(),
    taximeter_configs: z.unknown().optional()
  })
  .passthrough();

export const TdWebhookPayloadSchema = z
  .object({
    type: z.enum(['status', 'position']).or(CoercedString),
    code: CoercedString.optional(),
    status: z
      .union([z.number(), z.string()])
      .transform(v => (v === '' || v === undefined ? null : Number(v)))
      .nullable()
      .optional(),
    datetime: z.union([z.number(), z.string()]).optional(),
    data: z.unknown().optional(),
    booking_id: CoercedString.optional(),
    external_authorization_id: CoercedString.optional(),
    api_version: CoercedString.optional(),
    amount: z.union([z.number(), z.string()]).optional(),
    stopped_time: z.union([z.number(), z.string()]).optional(),
    stopped_time_value: z.union([z.number(), z.string()]).optional(),
    toll_value: z.union([z.number(), z.string()]).optional(),
    parking_value: z.union([z.number(), z.string()]).optional(),
    discount_value: z.union([z.number(), z.string()]).optional(),
    driver_comment: CoercedString.optional(),
    km: z.union([z.number(), z.string()]).optional(),
    time: z.union([z.number(), z.string()]).optional(),
    category_id: CoercedString.optional(),
    taximeter_configs: z.unknown().optional()
  })
  .passthrough();

/**
 * Campos proibidos por LGPD / Minimização de Dados (posição GPS e dados pessoais sensíveis)
 */
const FORBIDDEN_POSITION_AND_PII_KEYS = new Set([
  'latitude',
  'longitude',
  'init_lat',
  'init_lng',
  'end_lat',
  'end_lng',
  'speed',
  'angle',
  'position_date',
  'driver_photo',
  'phone_number',
  'user_phone',
  'passenger_number',
  'car_phone_number'
]);

/**
 * Remove recursivamente coordenadas de posição e dados pessoais desnecessários
 * do payload bruto do webhook antes de gravar no banco.
 */
export function sanitizeWebhookPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_POSITION_AND_PII_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (key === 'data' && typeof val === 'string') {
      // No evento de status, 'data' às vezes vem como string "{driver_name : João da Silva}" -> não gravar nome de motorista do campo 'data' textual
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = sanitizeWebhookPayload(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
