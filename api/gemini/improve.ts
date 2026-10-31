import { z } from 'zod';
import { requireAuth, sendJson } from '../_lib/auth.js';

const ImproveRequestSchema = z.object({
  voucher: z.string().optional().default(''),
  motivo_glosa_fiscal: z.string().optional().default(''),
  origem: z.string().optional().default('Não informada'),
  destino: z.string().optional().default('Não informada'),
  km_estimado: z.union([z.string(), z.number()]).transform(v => String(v)),
  km_real: z.union([z.string(), z.number()]).transform(v => String(v)),
  valor_estimado: z.union([z.string(), z.number()]).transform(v => String(v)),
  valor_cobrado: z.union([z.string(), z.number()]).transform(v => String(v)),
  registro_motorista: z.string().optional().default('Sem observação prévia registrada.')
});

const SYSTEM_INSTRUCTION = `Você é um auditor e assistente técnico especializado em faturamento de transporte corporativo (Contrato Petrobras SAP 4600686169).
REQUISITO CRÍTICO DE CONFORMIDADE (PROIBIDO INVENTAR FATOS):
- NUNCA invente vias, rodovias, portarias, horários, motivos externos, obras, condições climáticas ou acidentes que NÃO estejam explicitamente presentes no relato do motorista ou nos dados brutos da corrida.
- Toda resposta deve ser 100% comprovável através do cruzamento estrito dos dados fornecidos:
  * Valor cobrado vs Valor orçado.
  * KM percorrido real vs KM estimado.
  * Registro original deixado pelo motorista no sistema / webhook.
- Se o relato do motorista for vazio ou insuficiente, apenas formalize a redação técnica dentro das cláusulas contratuais aplicáveis (ex: cobrança baseada na quilometragem efetivamente percorrida e aferida no taxímetro/GPS homologado), sem presumir fatos não comprovados.
- Responda sempre em Português do Brasil com tom formal, conciso e jurídico-administrativo.
- Retorne APENAS o texto final da justificativa (1 a 2 frases), sem aspas e sem introduções.`;

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
    return;
  }

  const session = requireAuth(req, res);
  if (!session) return;

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    sendJson(res, 500, {
      ok: false,
      error: 'Variável GEMINI_API_KEY não configurada no servidor.'
    });
    return;
  }

  let bodyObj: unknown = req.body;
  if (typeof bodyObj === 'string') {
    try {
      bodyObj = JSON.parse(bodyObj);
    } catch {
      sendJson(res, 400, { ok: false, error: 'JSON inválido.' });
      return;
    }
  }

  const parsed = ImproveRequestSchema.safeParse(bodyObj);
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: 'Parâmetros inválidos para enriquecimento IA.' });
    return;
  }

  const payload = parsed.data;
  const configuredModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const models = Array.from(new Set([configuredModel, 'gemini-2.5-flash', 'gemini-flash-latest']));

  const userPrompt = `${SYSTEM_INSTRUCTION}

Analise os dados da corrida e reescreva a justificativa técnica estrita para contestação do apontamento:

DADOS BRUTOS DA CORRIDA (JSON):
${JSON.stringify(payload, null, 2)}`;

  let lastErrorMsg = 'Falha ao comunicar com a API do Gemini.';

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 220
          }
        })
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as any;
        lastErrorMsg = errJson?.error?.message || `Erro ${response.status} na API Gemini`;
        continue;
      }

      const data = (await response.json()) as any;
      const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (generatedText) {
        sendJson(res, 200, {
          ok: true,
          originalText: payload.registro_motorista,
          suggestedText: String(generatedText).trim().replace(/^["']|["']$/g, ''),
          modelUsed: model
        });
        return;
      }
    } catch (err: any) {
      lastErrorMsg = err?.message || lastErrorMsg;
    }
  }

  sendJson(res, 502, { ok: false, error: lastErrorMsg });
}
