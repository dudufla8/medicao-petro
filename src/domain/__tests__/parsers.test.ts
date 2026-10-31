import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  formatSecondsToHMS,
  formatTdRequestDate,
  parseDetailsDate,
  parseDetailsNumber,
  parseReportDate,
  parseReportNumber,
  parseStoppedTimeToSeconds,
  sanitizeWebhookPayload
} from '../parsers';

describe('Armadilhas de Parsing - Datas, Números e Sanitização LGPD', () => {
  it('converte números do relatório com ponto decimal sem confundir com milhar', () => {
    expect(parseReportNumber('93.98')).toBe(93.98);
    expect(parseReportNumber('23.000')).toBe(23);
    expect(parseReportNumber('23.110')).toBe(23.11);
    expect(parseReportNumber('')).toBe(0);
  });

  it('converte números do details com vírgula decimal sem tratar vírgula como milhar', () => {
    expect(parseDetailsNumber('53,76')).toBe(53.76);
    expect(parseDetailsNumber('21,795')).toBe(21.795);
    expect(parseDetailsNumber('0,42')).toBe(0.42);
    expect(parseDetailsNumber('5,93')).toBe(5.93);
  });

  it('faz parse de datas do relatório em formato M/d/yyyy h:mm:ss AM/PM no fuso America/Sao_Paulo', () => {
    // 9/1/2018 10:02:29 AM -> 1 de setembro de 2018 às 10:02:29 (-03:00) = 13:02:29Z
    const isoAm = parseReportDate('9/1/2018 10:02:29 AM');
    expect(isoAm).toBe('2018-09-01T13:02:29.000Z');

    // 9/1/2018 10:43:04 PM -> 22:43:04 (-03:00) = dia seguinte 01:43:04Z
    const isoPm = parseReportDate('9/1/2018 10:43:04 PM');
    expect(isoPm).toBe('2018-09-02T01:43:04.000Z');
  });

  it('faz parse de datas do details em formato dd/MM/yyyy HH:mm:ss no fuso America/Sao_Paulo', () => {
    const iso = parseDetailsDate('01/09/2018 11:39:59');
    expect(iso).toBe('2018-09-01T14:39:59.000Z');
  });

  it('formata datas de requisição para dd/MM/yyyy HH:mm:ss', () => {
    expect(formatTdRequestDate('2026-10-01', false)).toBe('01/10/2026 00:00:00');
    expect(formatTdRequestDate('2026-10-04', true)).toBe('04/10/2026 23:59:59');
  });

  it('normaliza stopped_time tanto em segundos (webhook) quanto em HH:MM:SS (details)', () => {
    expect(parseStoppedTimeToSeconds(287)).toBe(287);
    expect(parseStoppedTimeToSeconds('345')).toBe(345);
    expect(parseStoppedTimeToSeconds('00:04:47')).toBe(287);
    expect(formatSecondsToHMS(287)).toBe('00:04:47');
  });

  it('remove coordenadas de posição e dados sensíveis do payload do webhook (LGPD)', () => {
    const dirty = {
      type: 'status',
      code: 'completed',
      status: 5,
      booking_id: '41976288',
      latitude: '-22.90',
      longitude: '-43.17',
      init_lat: -22.9,
      init_lng: -43.1,
      phone_number: '21999999999',
      driver_comment: 'Desvio na BR-116 devido a retenção'
    };

    const clean = sanitizeWebhookPayload(dirty);
    expect(clean.booking_id).toBe('41976288');
    expect(clean.driver_comment).toBe('Desvio na BR-116 devido a retenção');
    expect(clean.latitude).toBeUndefined();
    expect(clean.longitude).toBeUndefined();
    expect(clean.init_lat).toBeUndefined();
    expect(clean.phone_number).toBeUndefined();
  });

  it('preserva fórmulas XLOOKUP, % KM e % Valor após atualização com SheetJS 0.20.3', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['eVoucher', 'KM Real', 'KM Orçado', '% KM', 'Justificativa da Empresa', 'PAGAMENTO'],
      ['41976288', 25, 15, null, '', 'LIBERADO PAGAMENTO']
    ]);
    ws['D2'] = { t: 'n', f: '(B2-C2)/C2', v: 0.6667 };
    ws['E2'] = { t: 's', f: '_xlfn.XLOOKUP(A2,Base!A:A,Base!B:B,"")', v: '' };
    XLSX.utils.book_append_sheet(wb, ws, 'justificativas MOBICITY');

    // Simula escrita de justificativa preservando a fórmula de % KM em D2
    wb.Sheets['justificativas MOBICITY']['E2'] = { t: 's', v: 'Desvio pela BR-101 devido a interdição.' };
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const reloaded = XLSX.read(out, { type: 'array', cellFormula: true });

    expect(XLSX.version).toBe('0.20.3');
    expect(reloaded.Sheets['justificativas MOBICITY']['D2'].f).toBe('(B2-C2)/C2');
    expect(reloaded.Sheets['justificativas MOBICITY']['E2'].v).toBe('Desvio pela BR-101 devido a interdição.');
  });
});
