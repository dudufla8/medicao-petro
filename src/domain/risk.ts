import { parseStoppedTimeToSeconds } from './parsers.js';
import type { DriverNoteSource } from './ride.js';

export interface RiskThresholds {
  kmDiffPercent: number; // padrão: 0.40 (40%)
  kmDiffAbs: number; // padrão: 10 (10 km)
  longRideKm: number; // padrão: 90 (90 km)
  stoppedMinutes: number; // padrão: 30 (30 min)
  stoppedValueBrl: number; // padrão: 30 (R$ 30)
  highValueBrl: number; // padrão: 300 (R$ 300)
  valueDiffPercentPetrobras: number; // padrão: 0.20 (20% acima do orçado na régua Petrobras)
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  kmDiffPercent: 0.4,
  kmDiffAbs: 10,
  longRideKm: 90,
  stoppedMinutes: 30,
  stoppedValueBrl: 30,
  highValueBrl: 300,
  valueDiffPercentPetrobras: 0.2
};

export interface RiskCheckInput {
  kmReal?: number | string;
  kmRealizado?: number | string;
  kmEstimado?: number | string;
  kmOrcado?: number | string;
  valorTotal?: number | string;
  valorCorrida?: number | string;
  custo?: number | string;
  valorSemExtras?: number | string;
  valorEstimado?: number | string;
  orcamento?: number | string;
  tempoParado?: string | number;
  stoppedTimeSeconds?: number;
  valorHoraParada?: number | string;
  custoEspera?: number | string;
  valorPedagio?: number | string;
  validacaoAnalista?: string;
  validacaoApoio?: string;
  obsMoto?: string;
  rawJustification?: string;
  webhookDriverComment?: string;
  hasWebhookEvent?: boolean;
  driverNoteSource?: DriverNoteSource;
}

export interface RiskCheckResult {
  isManual: boolean;
  needsJustification: boolean;
  reasons: string[];
  driverNoteUnavailableViaApi: boolean;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Radar de Risco Puro e Configurável
 */
export function evaluateRideRisk(
  ride: RiskCheckInput,
  customThresholds?: Partial<RiskThresholds>
): RiskCheckResult {
  const t: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS, ...(customThresholds || {}) };
  const reasons: string[] = [];

  const kmReal = toNum(ride.kmReal ?? ride.kmRealizado);
  const kmEst = toNum(ride.kmEstimado ?? ride.kmOrcado);
  const valorReal = toNum(ride.valorTotal ?? ride.valorCorrida ?? ride.custo);
  const valorEst = toNum(ride.valorEstimado ?? ride.orcamento);
  const valorParado = toNum(ride.valorHoraParada ?? ride.custoEspera);
  const valorPedagio = toNum(ride.valorPedagio);
  const valorSemExtras =
    ride.valorSemExtras !== undefined
      ? toNum(ride.valorSemExtras)
      : Math.max(0, valorReal - valorParado - valorPedagio);

  const stoppedSeconds =
    ride.stoppedTimeSeconds !== undefined
      ? ride.stoppedTimeSeconds
      : parseStoppedTimeToSeconds(ride.tempoParado);
  const stoppedMinutes = stoppedSeconds / 60;

  const validacaoAnalista = String(
    ride.validacaoAnalista || ride.validacaoApoio || ''
  ).toLowerCase();
  const obsMoto = String(ride.obsMoto || '').toLowerCase();
  const justRaw = String(ride.rawJustification || '').trim();
  const webhookComment = String(ride.webhookDriverComment || '').trim();

  // 1. Diferença de KM (> 40% ou > 10 km a mais)
  if (kmEst > 0) {
    const diffKm = kmReal - kmEst;
    const percKm = diffKm / kmEst;
    if (percKm > t.kmDiffPercent || diffKm > t.kmDiffAbs) {
      reasons.push(
        `KM Real (+${(percKm * 100).toFixed(0)}% / +${diffKm.toFixed(1)} km) acima do limite configurado (${(t.kmDiffPercent * 100).toFixed(0)}% ou ${t.kmDiffAbs} km). Confira o trajeto no GPS.`
      );
    }
  }

  // 2. Corrida de longa distância (> 90 km)
  if (kmReal > t.longRideKm || validacaoAnalista.includes('acima de 90 km')) {
    reasons.push(`Corrida de longa distância (acima de ${t.longRideKm} KM: ${kmReal.toFixed(1)} km).`);
  }

  // 3. KM Real muito abaixo do estimado
  const kmMuchLower = kmEst > 5 && kmReal > 0 && (kmReal - kmEst) / kmEst <= -0.35;
  if (
    kmMuchLower ||
    validacaoAnalista.includes('km muito abaixo') ||
    validacaoAnalista.includes('km real muito abaixo') ||
    validacaoAnalista.includes('km abaxio') ||
    validacaoAnalista.includes('km abaixo')
  ) {
    reasons.push('KM Real muito inferior ao previsto. Divergência acentuada de percurso.');
  }

  // 4. Local de embarque ou desembarque diferente
  if (
    validacaoAnalista.includes('local diferente') ||
    validacaoAnalista.includes('desembarque') ||
    validacaoAnalista.includes('embarque')
  ) {
    reasons.push(
      'Desembarque/Embarque divergente do chamado. Verifique se o passageiro ficou na portaria ou PV.'
    );
  }

  // 5. Hora parada elevada (> 30 min ou > R$ 30)
  if (
    valorParado > t.stoppedValueBrl ||
    stoppedMinutes > t.stoppedMinutes ||
    validacaoAnalista.includes('hora parada acima de r$ 30')
  ) {
    reasons.push(
      `Hora parada elevada (R$ ${valorParado.toFixed(2)} | ${Math.round(stoppedMinutes)} min). Necessário ateste ou justificativa de espera.`
    );
  }

  // 6. Alto Valor (> R$ 300)
  if (valorReal > t.highValueBrl || validacaoAnalista.includes('acima dos r$ 300')) {
    reasons.push(
      `Corrida de alto valor (R$ ${valorReal.toFixed(2)} > R$ ${t.highValueBrl.toFixed(2)}). Fiscalização audita detalhadamente.`
    );
  }

  // 7. Suspeita de cancelamento no sistema
  if (obsMoto.includes('cancel') || validacaoAnalista.includes('cancelada')) {
    reasons.push(
      'Registro de cancelamento no sistema TX20. Confirme se foi indevidamente cobrada na medição.'
    );
  }

  // 8. Ausência de anotação do motorista (respeitando estritamente a Regra 3 do Webhook)
  const driverNoteUnavailableViaApi =
    ride.driverNoteSource === 'unavailable_via_api' ||
    (ride.hasWebhookEvent === false && !justRaw && !obsMoto && !webhookComment);

  if (!justRaw && !obsMoto && !webhookComment && !driverNoteUnavailableViaApi) {
    reasons.push(
      'Motorista não registrou justificativa (nem via Webhook nem no TX20). Verifique o mapa manualmente.'
    );
  }

  // Verifica se é candidata a pedido de justificativa na régua da Petrobras (> 20% do valor orçado, pedágio, HP ou apontamento)
  const percValor = valorEst > 0 ? (valorSemExtras - valorEst) / valorEst : 0;
  const needsJustification =
    reasons.length > 0 ||
    percValor >= t.valueDiffPercentPetrobras ||
    valorPedagio > 0 ||
    valorParado > 0 ||
    Boolean(validacaoAnalista && !validacaoAnalista.includes('aprovada'));

  return {
    isManual: reasons.length > 0,
    needsJustification,
    reasons,
    driverNoteUnavailableViaApi
  };
}

/**
 * Mantém compatibilidade com a assinatura antiga checkManualReview(ride)
 */
export function checkManualReview(ride: RiskCheckInput, customThresholds?: Partial<RiskThresholds>) {
  return evaluateRideRisk(ride, customThresholds);
}
