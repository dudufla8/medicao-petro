// Cliente Frontend para enriquecimento de justificativas via rota serverless /api/gemini/improve
// Nenhuma credencial do Gemini trafega ou existe no navegador.

import { getStoredSessionToken } from './apiClient';

/**
 * Envia os dados estruturados da corrida para /api/gemini/improve no backend
 * @param {object} ride Dados da corrida
 * @returns {Promise<string>}
 */
export async function generateGeminiJustification(ride) {
  const payload = {
    voucher: String(ride.evoucher || ride.qru || ''),
    motivo_glosa_fiscal: String(ride.validacaoAnalista || ride.validacaoApoio || ''),
    origem: `${ride.cidadeOrigem ? ride.cidadeOrigem + ' - ' : ''}${ride.origem || ''}`.trim() || 'Não informada',
    destino: `${ride.cidadeDestino ? ride.cidadeDestino + ' - ' : ''}${ride.destino || ''}`.trim() || 'Não informada',
    km_estimado: String(ride.kmEstimado || '0'),
    km_real: String(ride.kmReal || '0'),
    valor_estimado: String(ride.valorEstimado || '0'),
    valor_cobrado: String(ride.valorTotal || '0'),
    registro_motorista: String(ride.rawJustification || ride.obsMoto || 'Sem observação prévia registrada.')
  };

  const token = getStoredSessionToken();
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch('/api/gemini/improve', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Erro ${response.status} ao solicitar sugestão da IA.`);
  }

  return data.suggestedText;
}
