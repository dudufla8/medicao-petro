export type JustificationScore = 'strong' | 'medium' | 'weak';

export interface JustificationQualityResult {
  score: JustificationScore;
  label: string;
  feedback: string;
}

const WEAK_PATTERNS: RegExp[] = [
  /trajeto\s+mais\s+curto/i,
  /trajeto\s+escolhido\s+pelo\s+cliente/i,
  /trajeto\s+escolhido\s+pelo\s+passageiro/i,
  /corrida\s+normal/i,
  /tudo\s+certo/i,
  /tudo\s+ok/i,
  /conforme\s+gps$/i,
  /conforme\s+solicitado$/i,
  /pedido\s+do\s+cliente$/i,
  /pedido\s+do\s+passageiro$/i,
  /sem\s+altera[cç][aã]o/i,
  /atendimento\s+normal/i
];

const STRONG_KEYWORDS: RegExp[] = [
  /br[-\s]?\d+/i,
  /ce[-\s]?\d+/i,
  /sp[-\s]?\d+/i,
  /rj[-\s]?\d+/i,
  /mg[-\s]?\d+/i,
  /pr[-\s]?\d+/i,
  /rs[-\s]?\d+/i,
  /anel\s+vi[aá]rio/i,
  /rodovia/i,
  /linha\s+verde/i,
  /linha\s+vermelha/i,
  /linha\s+amarela/i,
  /linha\s+azul/i,
  /avenida\s+[a-z]+/i,
  /av\.\s+[a-z]+/i,
  /rua\s+[a-z]+/i,
  /via\s+expressa/i,
  /contorno/i,
  /portaria/i,
  /posto\s+de\s+vigil[aâ]ncia/i,
  /pv\d*/i,
  /chapor/i,
  /reduc/i,
  /regap/i,
  /repar/i,
  /refap/i,
  /lubnor/i,
  /cenpes/i,
  /imbetiba/i
];

export function evaluateJustificationQuality(text: unknown): JustificationQualityResult {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      score: 'weak',
      label: 'Não Preenchida',
      feedback: 'Justificativa vazia. Preencha ou use o assistente de IA.'
    };
  }

  const clean = text.trim();

  if (clean.length < 25) {
    return {
      score: 'weak',
      label: 'Muito Curta',
      feedback: 'Texto com menos de 25 caracteres. Risco alto de glosa do analista.'
    };
  }

  if (clean.toLowerCase().includes('corrida cancelada') && clean.toLowerCase().includes('desconto')) {
    return {
      score: 'strong',
      label: 'Contestação Válida',
      feedback: 'Contestação formal de cancelamento conforme diretrizes.'
    };
  }

  for (const pattern of WEAK_PATTERNS) {
    if (pattern.test(clean) && !STRONG_KEYWORDS.some(k => k.test(clean))) {
      return {
        score: 'weak',
        label: 'Genérica / Fraca',
        feedback: `Resposta vaga ("${clean.slice(0, 35)}..."). O analista exige menção a vias ou portarias específicas.`
      };
    }
  }

  const hasStrongKeywords = STRONG_KEYWORDS.some(k => k.test(clean));
  const hasCause =
    /tr[aâ]nsito|lentid[aã]o|acidente|chuva|obra|engarrafamento|bloqueio|interdi[cç][aã]o|solicitou|pediu|seguran[cç]a|tax[ií]metro|contratual/i.test(
      clean
    );

  if (hasStrongKeywords && hasCause) {
    return {
      score: 'strong',
      label: 'Forte (Padrão)',
      feedback: 'Justificativa completa com motivo e vias/pontos detalhados.'
    };
  }

  if (hasStrongKeywords || hasCause || clean.length > 60) {
    return {
      score: 'medium',
      label: 'Média (Aceitável)',
      feedback: 'Aceitável, mas pode ser enriquecida citando a via principal utilizada.'
    };
  }

  return {
    score: 'weak',
    label: 'Fraca',
    feedback: 'Falta detalhamento de rota ou motivo concreto.'
  };
}
