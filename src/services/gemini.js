// Integração com Google Gemini API para Auditoria e Enriquecimento Estrito de Justificativas

const DEFAULT_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

const SYSTEM_INSTRUCTION = `Você é um auditor e assistente técnico especializado em faturamento de transporte corporativo.
REQUISITO CRÍTICO DE CONFORMIDADE:
- NUNCA invente acontecimentos, motivos externos, obras, condições climáticas ou acidentes a menos que tais fatos estejam explicitamente descritos nos dados brutos fornecidos.
- Toda resposta deve ser 100% comprovável através do cruzamento estrito dos dados fornecidos:
  * Valor cobrado vs Valor orçado.
  * KM percorrido real vs KM estimado.
  * Tempo de viagem e horários registrados.
  * Registro original deixado pelo motorista no sistema.
- Se o motivo fornecido for insuficiente, sua função é apenas formalizar a redação técnica dentro das cláusulas contratuais aplicáveis (ex: cobrança baseada no trajeto via taxímetro eletrônico homologado / cobrança de quilometragem rodada aferida), sem presumir fatos não comprovados.
- Responda sempre em Português do Brasil com tom formal, conciso e jurídico-administrativo.
- Retorne APENAS o texto final da justificativa (1 a 2 frases), sem aspas, sem introduções do tipo "Aqui está" ou saudações.`;

/**
 * Envia os dados estruturados da corrida para o Gemini com regras estritas anti-alucinação
 * @param {object} ride Dados da corrida
 * @param {string} customApiKey Chave opcional configurada pelo usuário
 * @returns {Promise<string>}
 */
export async function generateGeminiJustification(ride, customApiKey) {
  const apiKey = (customApiKey || localStorage.getItem('GEMINI_API_KEY') || DEFAULT_API_KEY).trim();
  
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada.");
  }

  // Payload estruturado exatamente como solicitado
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

  const userPrompt = `${SYSTEM_INSTRUCTION}

Analise os dados da corrida e elabore a justificativa técnica estrita para contestação do apontamento:

DADOS BRUTOS DA CORRIDA (JSON):
${JSON.stringify(payload, null, 2)}`;

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
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.1, // Temperatura baixa para máxima fidelidade aos dados
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
    }
  }

  throw lastError || new Error("Falha ao comunicar com a API do Gemini.");
}
