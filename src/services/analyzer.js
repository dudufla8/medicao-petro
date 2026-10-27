// Motor de Análise de Qualidade e Alertas de Risco para Medição Petrobras

// Palavras e expressões fracas ou genéricas que analistas rejeitam
const WEAK_PATTERNS = [
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

// Termos que indicam detalhes concretos de via ou pontos de referência
const STRONG_KEYWORDS = [
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

/**
 * Avalia a qualidade da justificativa
 * @param {string} text 
 * @returns {{ score: 'strong' | 'medium' | 'weak', label: string, feedback: string }}
 */
export function evaluateJustificationQuality(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      score: 'weak',
      label: 'Não Preenchida',
      feedback: 'Justificativa vazia. Preencha ou use o assistente de IA.'
    };
  }

  const clean = text.trim();

  // Muito curta
  if (clean.length < 25) {
    return {
      score: 'weak',
      label: 'Muito Curta',
      feedback: 'Texto com menos de 25 caracteres. Risco alto de glosa do analista.'
    };
  }

  // Verifica se é padrão de corrida cancelada (que é válida e aprovada como forte)
  if (clean.toLowerCase().includes('corrida cancelada') && clean.toLowerCase().includes('desconto')) {
    return {
      score: 'strong',
      label: 'Contestação Válida',
      feedback: 'Contestação formal de cancelamento conforme diretrizes.'
    };
  }

  // Verifica termos genéricos proibidos
  for (const pattern of WEAK_PATTERNS) {
    if (pattern.test(clean) && !STRONG_KEYWORDS.some(k => k.test(clean))) {
      return {
        score: 'weak',
        label: 'Genérica / Fraca',
        feedback: 'Resposta vaga ("' + clean.slice(0, 35) + '..."). O analista exige menção a vias ou portarias específicas.'
      };
    }
  }

  // Verifica termos fortes
  const hasStrongKeywords = STRONG_KEYWORDS.some(k => k.test(clean));
  const hasCause = /tr[aâ]nsito|lentid[aã]o|acidente|chuva|obra|engarrafamento|bloqueio|interdi[cç][aã]o|solicitou|pediu|seguran[cç]a/i.test(clean);

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

/**
 * Radar de Risco: Verifica se a corrida exige verificação manual no sistema
 * @param {object} ride 
 * @returns {{ isManual: boolean, reasons: string[] }}
 */
export function checkManualReview(ride) {
  const reasons = [];

  const kmReal = parseFloat(ride.kmReal || ride.kmRealizado || 0);
  const kmEst = parseFloat(ride.kmEstimado || ride.kmOrcado || 0);
  const valorReal = parseFloat(ride.valorTotal || ride.valorCorrida || ride.custo || 0);
  const valorEst = parseFloat(ride.valorEstimado || ride.orcamento || 0);
  const tempoParado = ride.tempoParado || '';
  const valorParado = parseFloat(ride.valorHoraParada || ride.custoEspera || 0);
  const validacaoAnalista = (ride.validacaoAnalista || ride.validacaoApoio || '').toLowerCase();
  const obsMoto = (ride.obsMoto || '').toLowerCase();
  const justRaw = (ride.rawJustification || '').trim();

  // 1. Diferença extrema de KM (> 45% e mais de 10km a mais, ou km real > 2x estimado)
  if (kmEst > 0) {
    const diffKm = kmReal - kmEst;
    const percKm = diffKm / kmEst;
    if (percKm > 0.45 && diffKm > 10) {
      reasons.push(`KM Real (+${(percKm * 100).toFixed(0)}%) muito acima do orçado (Dif: +${diffKm.toFixed(1)} km). Confira o trajeto no GPS.`);
    } else if (kmReal > 90 || validacaoAnalista.includes('acima de 90 km')) {
      reasons.push(`Corrida de longa distância (acima de 90 KM: ${kmReal.toFixed(1)} km).`);
    }
  }

  // 2. KM Real muito abaixo do estimado (suspeita de corrida não completada ou mapa com erro)
  if (validacaoAnalista.includes('km muito abaixo') || validacaoAnalista.includes('km real muito abaixo')) {
    reasons.push('KM Real muito inferior ao previsto. Analista apontou divergência de percurso.');
  }

  // 3. Local de embarque ou desembarque diferente
  if (validacaoAnalista.includes('local diferente') || validacaoAnalista.includes('desembarque')) {
    reasons.push('Desembarque/Embarque divergente do chamado. Verifique se o passageiro ficou na portaria ou PV.');
  }

  // 4. Hora parada excessiva (> 30 min ou > R$ 30)
  const tempoParadoStr = String(ride.tempoParado || '');
  if (valorParado > 30 || validacaoAnalista.includes('hora parada acima de r$ 30') || tempoParadoStr.startsWith('00:4') || tempoParadoStr.startsWith('00:5') || tempoParadoStr.startsWith('01:')) {
    reasons.push(`Hora parada elevada (R$ ${valorParado.toFixed(2)} | ${tempoParadoStr || 'tempo alto'}). Necessário ateste ou justificativa de espera.`);
  }

  // 5. Alto Valor (> R$ 300)
  if (valorReal > 300 || validacaoAnalista.includes('acima dos r$ 300')) {
    reasons.push(`Corrida de alto valor (R$ ${valorReal.toFixed(2)}). Fiscalização audita detalhadamente.`);
  }

  // 6. Suspeita de cancelamento no sistema
  if (obsMoto.includes('cancel') || validacaoAnalista.includes('cancelada')) {
    reasons.push('Registro de cancelamento no sistema TX20. Confirme se foi indevidamente cobrada na medição.');
  }

  // 7. Ausência total de anotação do motorista no sistema TX20
  if (!justRaw && !obsMoto) {
    reasons.push('Motorista não registrou justificativa no sistema TX20. Verifique o mapa manualmente.');
  }

  return {
    isManual: reasons.length > 0,
    reasons
  };
}
