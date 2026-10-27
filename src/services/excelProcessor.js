import * as XLSX from 'xlsx';
import { evaluateJustificationQuality, checkManualReview } from './analyzer';

/**
 * Lê e indexa a planilha do Sistema TX20 (sistema tx20...xlsx)
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {Map<string, object>} Mapa chaveado por QRU e por eVoucher
 */
export function parseSistemaTX20(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  
  // Converte para matriz de linhas
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Encontra linha de cabeçalho (que contenha No.Chamado ou QRU)
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(rawData.length, 10); r++) {
    const row = rawData[r] || [];
    if (row.some(c => String(c).toLowerCase().includes('chamado') || String(c).toLowerCase().includes('qru'))) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx === -1) {
    headerRowIdx = 2; // padrão observado
  }

  const headers = rawData[headerRowIdx] || [];
  
  // Localiza índices das colunas principais
  let colQru = headers.findIndex(h => String(h).toLowerCase().includes('chamado') || String(h).toLowerCase().includes('qru'));
  let colEvoucher = headers.findIndex(h => String(h).toLowerCase().includes('voucher') || String(h).toLowerCase().includes('reserva'));
  let colJust = headers.findIndex(h => String(h).toLowerCase().includes('justificativas e infos da qru'));
  let colObsMoto = headers.findIndex(h => String(h).toLowerCase().includes('obs.moto'));
  let colObsInt = headers.findIndex(h => String(h).toLowerCase().includes('obs.interna'));
  let colOrigem = headers.findIndex(h => String(h).toLowerCase().includes('logradouro_origem'));
  let colDestino = headers.findIndex(h => String(h).toLowerCase().includes('logradouro destino'));
  let colMotorista = headers.findIndex(h => String(h).toLowerCase() === 'motorista');
  let colPlaca = headers.findIndex(h => String(h).toLowerCase() === 'carro moto' || String(h).toLowerCase().includes('placa'));

  // Se a coluna de justificativa não foi achada pelo nome exato, verifica coluna 86 (CI)
  if (colJust === -1 && headers.length > 86) {
    colJust = 86;
  }
  if (colQru === -1) colQru = 0;
  if (colEvoucher === -1) colEvoucher = 47;
  if (colObsMoto === -1) colObsMoto = 50;

  const dataMap = new Map();

  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.length === 0) continue;

    const qru = String(row[colQru] || '').trim();
    const evoucher = String(row[colEvoucher] || '').trim();
    const justInfo = String(row[colJust] || '').trim();
    const obsMoto = String(row[colObsMoto] || '').trim();
    const obsInt = colObsInt !== -1 ? String(row[colObsInt] || '').trim() : '';

    if (!qru && !evoucher) continue;

    const record = {
      qru,
      evoucher,
      justificativaTX20: justInfo,
      obsMoto,
      obsInterna: obsInt,
      motorista: colMotorista !== -1 ? String(row[colMotorista] || '').trim() : '',
      origem: colOrigem !== -1 ? String(row[colOrigem] || '').trim() : '',
      destino: colDestino !== -1 ? String(row[colDestino] || '').trim() : '',
    };

    if (qru) {
      dataMap.set(`qru_${qru}`, record);
    }
    if (evoucher) {
      dataMap.set(`ev_${evoucher}`, record);
    }
  }

  return dataMap;
}

/**
 * Lê a planilha de medição da Petrobras (MC - ... .xlsx)
 * @param {ArrayBuffer} arrayBuffer 
 * @param {Map<string, object> | null} tx20Map Mapa do sistema tx20
 * @returns {{ workbook: any, fileName: string, rides: Array<object>, sheetsFound: string[] }}
 */
export function parseMedicaoWorkbook(arrayBuffer, tx20Map = null) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const rides = [];

  const sheetNames = wb.SheetNames;

  // 1. Processar MOBICITY
  const mobJustSheet = sheetNames.find(s => s.toLowerCase().includes('justificativas') && s.toLowerCase().includes('mobicity'));
  const mobAnaliseSheet = sheetNames.find(s => s.toLowerCase().includes('análise mobicity') || s.toLowerCase().includes('analise mobicity'));

  const targetMobSheet = mobJustSheet || mobAnaliseSheet;
  if (targetMobSheet) {
    const ws = wb.Sheets[targetMobSheet];
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

    data.forEach((row, idx) => {
      // Se for a aba de análise completa, filtra apenas as que precisam de justificativa
      const validacao = row['Validação Apoio'] || row['Validação'] || '';
      const isAnaliseCompleta = !mobJustSheet;
      if (isAnaliseCompleta && String(validacao).toLowerCase().includes('aprovada')) {
        return;
      }
      if (!validacao && isAnaliseCompleta) return;

      const evoucher = String(row['evoucher'] || row['Reserva'] || row['Contrato'] || '').trim();
      const existingJust = String(row['Justificativa da Empresa'] || '').trim();
      const statusPagamento = String(row['PAGAMENTO'] || 'LIBERADO PAGAMENTO').trim();

      // Busca na base TX20
      let txRecord = null;
      if (tx20Map && evoucher) {
        txRecord = tx20Map.get(`ev_${evoucher}`);
      }

      const rawJust = txRecord?.justificativaTX20 || '';
      const obsMoto = txRecord?.obsMoto || '';

      // Define justificativa sugerida
      let suggestedJust = existingJust;
      let isAutoFilled = false;
      let isCancelled = obsMoto.toLowerCase().includes('cancel') || String(row['Problema na viagem'] || '').toLowerCase().includes('cancel');

      if (!suggestedJust) {
        if (isCancelled) {
          suggestedJust = 'CORRIDA CANCELADA - NÃO PODE TER DESCONTO DE VALOR DE CORRIDA DESCONTADA POIS NÃO COLOCAMOS ESSAS CORRIDAS NA MEDIÇÃO';
          isAutoFilled = true;
        } else if (rawJust && rawJust.length > 5) {
          suggestedJust = rawJust;
          isAutoFilled = true;
        }
      }

      const rideObj = {
        id: `mob_${idx}_${evoucher}`,
        system: 'MOBICITY',
        sheetName: targetMobSheet,
        rowIndex: idx + 2, // 1-indexed, linha 2 em diante (cabeçalho é 1)
        evoucher,
        qru: txRecord?.qru || '',
        passageiro: row['Passageiros'] || row['Criador da viagem'] || '',
        origem: row['Origem'] || '',
        cidadeOrigem: row['Cidade Origem'] || '',
        destino: row['Destino'] || '',
        cidadeDestino: row['Cidade Destino'] || '',
        motorista: row['Motorista'] || txRecord?.motorista || '',
        placa: row['Placa'] || '',
        kmReal: row['Km Realizado'] || row['KM'] || 0,
        kmEstimado: row['Km Orçado'] || 0,
        valorTotal: row['Valor Total'] || row['Custo'] || 0,
        valorEstimado: row['Orçamento'] || 0,
        difValor: row['Dif Valor'] || 0,
        tempoParado: row['Tempo de HP'] || '',
        custoEspera: row['Custo de espera'] || 0,
        validacaoApoio: validacao,
        validacaoAnalista: validacao,
        rawJustification: rawJust,
        obsMoto,
        currentJustification: suggestedJust,
        pagamento: statusPagamento || 'LIBERADO PAGAMENTO',
        isAutoFilled,
        isCancelled
      };

      // Avaliação de Qualidade e Alertas
      rideObj.quality = evaluateJustificationQuality(rideObj.currentJustification);
      rideObj.manualCheck = checkManualReview(rideObj);

      rides.push(rideObj);
    });
  }

  // 2. Processar SIMCORPI
  const simJustSheet = sheetNames.find(s => s.toLowerCase().includes('justificativas') && s.toLowerCase().includes('simcorpi'));
  const simAtualSheet = sheetNames.find(s => s.toLowerCase().includes('simcorpi atualizado'));

  const targetSimSheet = simJustSheet || simAtualSheet;
  if (targetSimSheet) {
    const ws = wb.Sheets[targetSimSheet];
    const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

    data.forEach((row, idx) => {
      const validacao = row['Validação Do Analista'] || row['Validação'] || '';
      const isAnaliseCompleta = !simJustSheet;
      if (isAnaliseCompleta && String(validacao).toLowerCase().includes('aprovada')) {
        return;
      }
      if (!validacao && isAnaliseCompleta) return;

      const qru = String(row['QRU'] || '').trim();
      const evoucher = String(row['eVoucher'] || row['Código da Reserva'] || '').trim();
      const existingJust = String(row['Justificativa da Empresa'] || '').trim();
      const statusPagamento = String(row['PAGAMENTO'] || 'LIBERADO PAGAMENTO').trim();

      // Busca na base TX20 por QRU ou por eVoucher
      let txRecord = null;
      if (tx20Map) {
        if (qru) txRecord = tx20Map.get(`qru_${qru}`);
        if (!txRecord && evoucher) txRecord = tx20Map.get(`ev_${evoucher}`);
      }

      const rawJust = txRecord?.justificativaTX20 || '';
      const obsMoto = txRecord?.obsMoto || '';

      let suggestedJust = existingJust;
      let isAutoFilled = false;
      let isCancelled = obsMoto.toLowerCase().includes('cancel') || String(row['Status Corrida'] || '').toLowerCase().includes('cancel');

      if (!suggestedJust) {
        if (isCancelled) {
          suggestedJust = 'CORRIDA CANCELADA - NÃO PODE TER DESCONTO DE VALOR DE CORRIDA DESCONTADA POIS NÃO COLOCAMOS ESSAS CORRIDAS NA MEDIÇÃO';
          isAutoFilled = true;
        } else if (rawJust && rawJust.length > 5) {
          suggestedJust = rawJust;
          isAutoFilled = true;
        }
      }

      const rideObj = {
        id: `sim_${idx}_${qru || evoucher}`,
        system: 'SIMCORPI',
        sheetName: targetSimSheet,
        rowIndex: idx + 2,
        qru,
        evoucher,
        passageiro: row['Usuário'] || row['Matrícula'] || '',
        origem: row['Origem.1'] || row['Origem'] || '',
        cidadeOrigem: row['Cidade Origem'] || '',
        destino: row['Destino Real'] || row['Destino Original'] || '',
        cidadeDestino: row['Cidade Destino'] || '',
        motorista: row['Motorista'] || txRecord?.motorista || '',
        placa: row['Placa'] || '',
        kmReal: row['KM Real'] || 0,
        kmEstimado: row['KM Estimado'] || 0,
        valorTotal: row['Valor Corrida'] || row['Valor Bruto'] || 0,
        valorEstimado: row['Valor Estimado'] || 0,
        difValor: row['Dif de Valor'] || 0,
        tempoParado: row['Tempo Parado'] || '',
        valorHoraParada: row['Valor Hora Parada'] || 0,
        validacaoAnalista: validacao,
        validacaoApoio: validacao,
        rawJustification: rawJust,
        obsMoto,
        currentJustification: suggestedJust,
        pagamento: statusPagamento || 'LIBERADO PAGAMENTO',
        isAutoFilled,
        isCancelled
      };

      rideObj.quality = evaluateJustificationQuality(rideObj.currentJustification);
      rideObj.manualCheck = checkManualReview(rideObj);

      rides.push(rideObj);
    });
  }

  return {
    workbook: wb,
    sheetNames,
    rides
  };
}

/**
 * Atualiza e exporta a planilha respondida mantendo fórmulas e abas intactas
 * @param {any} originalWorkbook 
 * @param {Array<object>} updatedRides 
 * @param {string} originalFileName 
 */
export function exportUpdatedWorkbook(originalWorkbook, updatedRides, originalFileName) {
  // Clona o workbook para edição
  const wb = originalWorkbook;

  // Agrupa as alterações por aba
  const ridesBySheet = {};
  updatedRides.forEach(r => {
    if (!ridesBySheet[r.sheetName]) {
      ridesBySheet[r.sheetName] = [];
    }
    ridesBySheet[r.sheetName].push(r);
  });

  for (const [sheetName, sheetRides] of Object.entries(ridesBySheet)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Encontra os índices das colunas "Justificativa da Empresa" e "PAGAMENTO"
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100');
    let justColLetter = null;
    let pagtoColLetter = null;

    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      const cell = ws[cellAddress];
      if (!cell || !cell.v) continue;

      const headerVal = String(cell.v).trim().toLowerCase();
      if (headerVal === 'justificativa da empresa' || headerVal === 'justificar da empresa') {
        justColLetter = XLSX.utils.encode_col(C);
      }
      if (headerVal === 'pagamento') {
        pagtoColLetter = XLSX.utils.encode_col(C);
      }
    }

    // Se não encontrou no cabeçalho exato, tenta linha 1
    if (!justColLetter) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 1, c: C });
        const cell = ws[cellAddress];
        if (!cell || !cell.v) continue;
        const headerVal = String(cell.v).trim().toLowerCase();
        if (headerVal.includes('justificativa da empresa')) {
          justColLetter = XLSX.utils.encode_col(C);
        }
        if (headerVal === 'pagamento') {
          pagtoColLetter = XLSX.utils.encode_col(C);
        }
      }
    }

    sheetRides.forEach(ride => {
      const rowNum = ride.rowIndex;
      
      if (justColLetter) {
        const justCellRef = `${justColLetter}${rowNum}`;
        ws[justCellRef] = { t: 's', v: ride.currentJustification || '' };
      }
      if (pagtoColLetter) {
        const pagtoCellRef = `${pagtoColLetter}${rowNum}`;
        ws[pagtoCellRef] = { t: 's', v: ride.pagamento || 'LIBERADO PAGAMENTO' };
      }
    });
  }

  // Gera o arquivo final em ArrayBuffer
  const outBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Dispara o download
  const cleanName = (originalFileName || 'Medicao_Petrobras').replace(/\.xlsx$/i, '');
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${cleanName} - JUSTIFICADA.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}
