// Re-exporta os módulos de domínio tipados mantendo 100% de compatibilidade com imports legados
export { evaluateJustificationQuality } from '../domain/quality';
export { checkManualReview, evaluateRideRisk, DEFAULT_RISK_THRESHOLDS } from '../domain/risk';
