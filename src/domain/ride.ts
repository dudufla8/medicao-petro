import {
  formatSecondsToHMS,
  parseDetailsDate,
  parseDetailsNumber,
  parseReportDate,
  parseReportNumber,
  parseStoppedTimeToSeconds,
  parseWebhookNumber,
  TdDetailsDataSchema,
  TdReportItemSchema,
  TdWebhookPayloadSchema
} from './parsers';

export type RideAuditStatus =
  | 'nova'
  | 'precisa_justificar'
  | 'justificada'
  | 'aprovada'
  | 'exportada';

export type DriverNoteSource =
  | 'approved_justification'
  | 'webhook_driver_comment'
  | 'tx20_column_ci'
  | 'tx20_cancelled'
  | 'unavailable_via_api'
  | 'empty';

export interface RideFinalFinancialData {
  bookingId: string;
  rideValue: number;
  serviceValue: number;
  stoppedTimeSeconds: number;
  stoppedTimeFormatted: string;
  stoppedTimeValue: number;
  tollValue: number;
  parkingValue: number;
  discountValue: number;
  km: number;
  timeInSeconds: number;
  driverComment: string;
  categoryId: string;
  source: 'webhook' | 'details';
  receivedAt: string;
}

export interface Tx20Record {
  qru: string;
  evoucher: string;
  justificativaTX20: string;
  obsMoto: string;
  obsInterna?: string;
  motorista?: string;
  origem?: string;
  destino?: string;
}

export interface NormalizedRide {
  id: string;
  bookingId: string; // eVoucher (hipótese padrão validada no Checkpoint C)
  serviceId: string; // QRU / No.Chamado
  evoucher: string;
  qru: string;
  system: 'MOBICITY' | 'SIMCORPI' | 'API_TD';
  statusName: string;
  registerDateIso: string | null;
  startDateIso: string | null;
  endDateIso: string | null;
  passageiro: string;
  solicitante: string;
  origem: string;
  cidadeOrigem: string;
  destino: string;
  cidadeDestino: string;
  motorista: string;
  placa: string;
  kmReal: number;
  kmEstimado: number;
  valorTotal: number;
  valorSemExtras: number;
  valorEstimado: number;
  difValor: number;
  percValorSemExtras: number;
  percKm: number;
  stoppedTimeSeconds: number;
  tempoParado: string;
  custoEspera: number;
  valorPedagio: number;
  valorEstacionamento: number;
  valorDesconto: number;
  timeInSeconds: number;
  unidade: string;
  diretoria: string;
  centroCusto: string;
  matricula: string;
  hasWebhookEvent: boolean;
  webhookDriverComment: string;
  tx20Justification: string;
  obsMoto: string;
  driverNoteSource: DriverNoteSource;
  driverNoteStatusLabel: string;
  rawJustification: string;
  currentJustification: string;
  auditStatus: RideAuditStatus;
  pagamento: string;
  isCancelled: boolean;
  isAutoFilled: boolean;
  isCompleted: boolean;
}

export const CANCELLED_CONTESTATION_TEXT =
  'CORRIDA CANCELADA - NÃO PODE TER DESCONTO DE VALOR DE CORRIDA DESCONTADA POIS NÃO COLOCAMOS ESSAS CORRIDAS NA MEDIÇÃO';

/**
 * Adaptador 1: Evento de Webhook status 5 ("completed") -> RideFinalFinancialData
 */
export function adaptWebhookCompletedToFinalData(
  rawPayload: unknown,
  receivedAtIso: string = new Date().toISOString()
): RideFinalFinancialData | null {
  const parsed = TdWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return null;

  const w = parsed.data;
  const isCompleted =
    String(w.code || '').toLowerCase() === 'completed' || Number(w.status) === 5;
  if (!isCompleted || !w.booking_id) {
    return null;
  }

  const rideValue = parseWebhookNumber(w.amount);
  const stoppedTimeSeconds = parseStoppedTimeToSeconds(w.stopped_time);
  const stoppedTimeValue = parseWebhookNumber(w.stopped_time_value);
  const tollValue = parseWebhookNumber(w.toll_value);
  const parkingValue = parseWebhookNumber(w.parking_value);
  const discountValue = parseWebhookNumber(w.discount_value);
  const km = parseWebhookNumber(w.km);
  const timeInSeconds = Math.round(parseWebhookNumber(w.time));

  // Valor sem extras pela fórmula Petrobras: Valor Total - Pedágio - Hora Parada - Estacionamento
  const serviceValue = Math.max(
    0,
    Number((rideValue - stoppedTimeValue - tollValue - parkingValue).toFixed(2))
  );

  return {
    bookingId: String(w.booking_id).trim(),
    rideValue,
    serviceValue,
    stoppedTimeSeconds,
    stoppedTimeFormatted: formatSecondsToHMS(stoppedTimeSeconds),
    stoppedTimeValue,
    tollValue,
    parkingValue,
    discountValue,
    km,
    timeInSeconds,
    driverComment: String(w.driver_comment || '').trim(),
    categoryId: String(w.category_id || '').trim(),
    source: 'webhook',
    receivedAt: receivedAtIso
  };
}

/**
 * Adaptador 2: Resposta de /api/booking/details/json -> RideFinalFinancialData
 */
export function adaptDetailsToFinalData(
  bookingId: string,
  rawDetailsData: unknown,
  receivedAtIso: string = new Date().toISOString()
): RideFinalFinancialData | null {
  const parsed = TdDetailsDataSchema.safeParse(rawDetailsData);
  if (!parsed.success) return null;

  const d = parsed.data;
  const rideValue = parseDetailsNumber(d.ride_value);
  const rawServiceValue = parseDetailsNumber(d.service_value);
  const stoppedTimeSeconds = parseStoppedTimeToSeconds(d.stopped_time);
  const stoppedTimeValue = parseDetailsNumber(d.stopped_time_value);
  const tollValue = parseDetailsNumber(d.tollgate_fare);
  const parkingValue = parseDetailsNumber(d.parking_fare);
  const discountValue = parseDetailsNumber(d.discount_value);
  const km = parseDetailsNumber(d.km);
  const timeInSeconds = Math.round(parseDetailsNumber(d.time_in_seconds));

  // Na fórmula Petrobras (M - O - Q), Valor sem extras desconta pedágio e espera do valor final cobrado
  const computedServiceValue =
    rideValue > 0
      ? Math.max(0, Number((rideValue - stoppedTimeValue - tollValue - parkingValue).toFixed(2)))
      : rawServiceValue;

  return {
    bookingId: String(bookingId).trim(),
    rideValue: rideValue || rawServiceValue,
    serviceValue: computedServiceValue,
    stoppedTimeSeconds,
    stoppedTimeFormatted: formatSecondsToHMS(stoppedTimeSeconds),
    stoppedTimeValue,
    tollValue,
    parkingValue,
    discountValue,
    km,
    timeInSeconds,
    driverComment: '', // details não possui driver_comment documentado
    categoryId: String(d.category_id || '').trim(),
    source: 'details',
    receivedAt: receivedAtIso
  };
}

/**
 * Resolve a anotação do motorista e a justificativa inicial seguindo a prioridade estrita:
 * 1. Justificativa aprovada / salva (approvedJustification)
 * 2. Comentário do motorista via Webhook (webhookDriverComment)
 * 3. Planilha TX20 (Cancelamento na Coluna AY ou Justificativa na Coluna CI / Obs.Moto)
 *
 * Regra crítica: Corrida sem evento de webhook NÃO significa "sem anotação" ->
 * marca "unavailable_via_api" ("Anotação indisponível via API").
 */
export function resolveDriverNotePriority(params: {
  approvedJustification?: string | null;
  webhookDriverComment?: string | null;
  hasWebhookEvent: boolean;
  tx20Record?: Tx20Record | null;
  statusName?: string;
}): {
  source: DriverNoteSource;
  statusLabel: string;
  rawDriverNote: string;
  effectiveJustification: string;
  isCancelled: boolean;
  isAutoFilled: boolean;
} {
  const approved = String(params.approvedJustification || '').trim();
  const webhookComment = String(params.webhookDriverComment || '').trim();
  const txJust = String(params.tx20Record?.justificativaTX20 || '').trim();
  const obsMoto = String(params.tx20Record?.obsMoto || '').trim();
  const statusStr = String(params.statusName || '').toLowerCase();

  const isCancelled =
    obsMoto.toLowerCase().includes('cancel') || statusStr.includes('cancel');

  // 1. Justificativa aprovada tem prioridade máxima
  if (approved) {
    return {
      source: 'approved_justification',
      statusLabel: 'Justificativa aprovada salva',
      rawDriverNote: webhookComment || txJust || obsMoto,
      effectiveJustification: approved,
      isCancelled,
      isAutoFilled: true
    };
  }

  // 2. driver_comment vindo do Webhook status 5
  if (webhookComment) {
    return {
      source: 'webhook_driver_comment',
      statusLabel: 'Anotação recebida via Webhook',
      rawDriverNote: webhookComment,
      effectiveJustification: webhookComment,
      isCancelled,
      isAutoFilled: true
    };
  }

  // 3. Planilha TX20: Cancelamento (Coluna AY / Obs.Moto) ou Coluna CI
  if (isCancelled) {
    return {
      source: 'tx20_cancelled',
      statusLabel: 'Cancelamento identificado no TX20',
      rawDriverNote: txJust || obsMoto,
      effectiveJustification: CANCELLED_CONTESTATION_TEXT,
      isCancelled: true,
      isAutoFilled: true
    };
  }

  if (txJust || obsMoto) {
    return {
      source: 'tx20_column_ci',
      statusLabel: 'Anotação importada da planilha TX20',
      rawDriverNote: txJust || obsMoto,
      effectiveJustification: txJust.length > 5 ? txJust : '',
      isCancelled: false,
      isAutoFilled: txJust.length > 5
    };
  }

  // Sem anotação até aqui: diferenciar entre "webhook não recebido" vs "webhook recebido vazio"
  if (!params.hasWebhookEvent && !params.tx20Record) {
    return {
      source: 'unavailable_via_api',
      statusLabel: 'Anotação indisponível via API (aguardando Webhook ou planilha TX20)',
      rawDriverNote: '',
      effectiveJustification: '',
      isCancelled: false,
      isAutoFilled: false
    };
  }

  return {
    source: 'empty',
    statusLabel: 'Sem anotação do motorista',
    rawDriverNote: '',
    effectiveJustification: '',
    isCancelled: false,
    isAutoFilled: false
  };
}

/**
 * Adaptador 3: Item do Relatório (/api/booking/report/json) + dados complementares -> NormalizedRide
 */
export function adaptReportItemToRide(
  rawReportItem: unknown,
  options?: {
    finalData?: RideFinalFinancialData | null;
    tx20Record?: Tx20Record | null;
    approvedJustification?: string | null;
    systemHint?: 'MOBICITY' | 'SIMCORPI' | 'API_TD';
  }
): NormalizedRide | null {
  const parsed = TdReportItemSchema.safeParse(rawReportItem);
  if (!parsed.success || !parsed.data.booking_id) {
    return null;
  }

  const r = parsed.data;
  const bookingId = r.booking_id;
  const serviceId = r.service_id || options?.tx20Record?.qru || '';

  const finalData = options?.finalData || null;
  const hasWebhookEvent = finalData?.source === 'webhook';

  const kmReal = finalData?.km && finalData.km > 0 ? finalData.km : parseReportNumber(r.real_distance);
  const kmEstimado = parseReportNumber(r.estimate_distance);

  const valorTotal =
    finalData?.rideValue && finalData.rideValue > 0
      ? finalData.rideValue
      : parseReportNumber(r.real_fare);
  const valorEstimado = parseReportNumber(r.estimate_fare);

  const custoEspera = finalData?.stoppedTimeValue ?? 0;
  const valorPedagio = finalData?.tollValue ?? 0;
  const valorEstacionamento = finalData?.parkingValue ?? 0;
  const valorDesconto = finalData?.discountValue ?? 0;
  const stoppedTimeSeconds = finalData?.stoppedTimeSeconds ?? 0;
  const tempoParado =
    stoppedTimeSeconds > 0 ? formatSecondsToHMS(stoppedTimeSeconds) : '';

  const valorSemExtras =
    finalData?.serviceValue && finalData.serviceValue > 0
      ? finalData.serviceValue
      : Math.max(0, Number((valorTotal - custoEspera - valorPedagio - valorEstacionamento).toFixed(2)));

  const difValor = Number((valorSemExtras - valorEstimado).toFixed(2));
  const percValorSemExtras =
    valorEstimado > 0 ? (valorSemExtras / valorEstimado) - 1 : 0;
  const percKm = kmEstimado > 0 ? (kmReal / kmEstimado) - 1 : 0;

  const noteResolution = resolveDriverNotePriority({
    approvedJustification: options?.approvedJustification,
    webhookDriverComment: hasWebhookEvent ? finalData?.driverComment : '',
    hasWebhookEvent,
    tx20Record: options?.tx20Record,
    statusName: r.status_name
  });

  const origem = [r.init_address_name, r.init_address_number]
    .filter(Boolean)
    .join(', ')
    .trim();

  return {
    id: `td_${bookingId}`,
    bookingId,
    serviceId,
    evoucher: bookingId,
    qru: serviceId,
    system: options?.systemHint || 'API_TD',
    statusName: r.status_name || '',
    registerDateIso: parseReportDate(r.register_date),
    startDateIso: parseReportDate(r.start_date),
    endDateIso: parseReportDate(r.end_date),
    passageiro: r.user_name || r.requester_name || '',
    solicitante: r.requester_name || r.user_name || '',
    origem: origem || options?.tx20Record?.origem || '',
    cidadeOrigem: '',
    destino: r.end_address_name || options?.tx20Record?.destino || '',
    cidadeDestino: '',
    motorista: r.taxi_driver || options?.tx20Record?.motorista || '',
    placa: r.taxi_vehicle_plate || '',
    kmReal,
    kmEstimado,
    valorTotal,
    valorSemExtras,
    valorEstimado,
    difValor,
    percValorSemExtras,
    percKm,
    stoppedTimeSeconds,
    tempoParado,
    custoEspera,
    valorPedagio,
    valorEstacionamento,
    valorDesconto,
    timeInSeconds: finalData?.timeInSeconds ?? 0,
    unidade: r.classifier1 || '',
    diretoria: r.classifier2 || '',
    centroCusto: r.classifier3 || '',
    matricula: r.classifier4 || '',
    hasWebhookEvent,
    webhookDriverComment: hasWebhookEvent ? finalData?.driverComment || '' : '',
    tx20Justification: options?.tx20Record?.justificativaTX20 || '',
    obsMoto: options?.tx20Record?.obsMoto || '',
    driverNoteSource: noteResolution.source,
    driverNoteStatusLabel: noteResolution.statusLabel,
    rawJustification: noteResolution.rawDriverNote,
    currentJustification: noteResolution.effectiveJustification,
    auditStatus: options?.approvedJustification
      ? 'aprovada'
      : noteResolution.effectiveJustification
        ? 'justificada'
        : 'nova',
    pagamento: 'LIBERADO PAGAMENTO',
    isCancelled: noteResolution.isCancelled,
    isAutoFilled: noteResolution.isAutoFilled,
    isCompleted: Boolean(options?.approvedJustification)
  };
}
