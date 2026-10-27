// Integração direta com Google Gemini API para Enriquecimento de Justificativas

const DEFAULT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

/**
 * Envia os dados da corrida para o Gemini reescrever ou gerar a justificativa ideal
 * @param {object} ride Dados da corrida
 * @param {string} customApiKey Chave opcional configurada pelo usuário
 * @returns {Promise<string>}
 */
export async function generateGeminiJustification(ride, customApiKey) {
  const apiKey = (customApiKey || localStorage.getItem('GEMINI_API_KEY') || DEFAULT_API_KEY).trim();
  
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada.");
  }

  // Dados de contexto
  const analista = ride.validacaoAnalista || ride.validacaoApoio || 'Justificar divergência de valor ou rota';
  const origem = `${ride.cidadeOrigem || ''} - ${ride.origem || ride.logradouroOrigem || ''}`.trim();
  const destino = `${ride.cidadeDestino || ''} - ${ride.destino || ride.logradouroDestino || ''}`.trim();
  const passageiro = ride.passageiro || ride.usuario || 'Passageiro Petrobras';
  const kmReal = ride.kmReal || ride.kmRealizado || '';
  const kmEst = ride.kmEstimado || ride.kmOrcado || '';
  const rascunhoMotorista = ride.rawJustification || '';
  const obsMoto = ride.obsMoto || '';

  const prompt = `Você é um especialista em conciliação de contratos de transporte corporativo da Petrobras.
Reescreva ou crie uma justificativa formal, técnica, direta e profissional (em 1 ou 2 frases curtas) para responder ao apontamento do analista da Petrobras.

DADOS DA CORRIDA:
- Apontamento do Analista: "${analista}"
- Origem: ${origem || 'Não informada'}
- Destino: ${destino || 'Não informada'}
- Passageiro: ${passageiro}
- Quilometragem: Real ${kmReal} km | Estimado ${kmEst} km
- Relato do Motorista / Sistema: "${rascunhoMotorista}"
- Observações do Sistema: "${obsMoto}"

DIRETRIZES OBRIGATÓRIAS:
1. Retorne APENAS o texto da justificativa final, sem saudações, sem aspas, sem introdução como "Aqui está".
2. Seja objetivo, formal e mencione vias/rodovias/portarias plausíveis (ex: anel viário, rodovia, portaria de segurança, vias expressas, retenção de tráfego) e alinhamento com o passageiro.
3. Se o apontamento for sobre desembarque diferente ou portaria, justifique que o desembarque ocorreu na portaria/posto de vigilância (PV) por exigência de acesso.
4. Se o apontamento for sobre cancelamento, informe formalmente que a corrida foi cancelada e não integra o faturamento da medição.`;

  // Testamos com gemini-3-flash-preview e fallback para gemini-flash-latest
  const models = ["gemini-3-flash-preview", "gemini-flash-latest"];
  
  let lastError = null;
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 200
          }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Erro ${response.status} na API Gemini`);
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (generatedText) {
        return generatedText.trim().replace(/^["']|["']$/g, '');
      }
    } catch (err) {
      lastError = err;
      // tenta o próximo modelo
    }
  }

  throw lastError || new Error("Falha ao comunicar com a API do Gemini.");
}
