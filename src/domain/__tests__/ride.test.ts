import { describe, expect, it } from 'vitest';
import {
  adaptDetailsToFinalData,
  adaptReportItemToRide,
  adaptWebhookCompletedToFinalData,
  CANCELLED_CONTESTATION_TEXT,
  resolveDriverNotePriority
} from '../ride';
import { evaluateRideRisk } from '../risk';

describe('Adaptadores de Domínio e Prioridade de Anotação do Motorista', () => {
  it('adapta evento completed (status 5) do webhook para RideFinalFinancialData', () => {
    const webhookPayload = {
      type: 'status',
      code: 'completed',
      status: 5,
      booking_id: '41976288',
      amount: '129,60',
      stopped_time: 287,
      stopped_time_value: '3,14',
      toll_value: '0,00',
      parking_value: '0,00',
      discount_value: '0,00',
      driver_comment: 'Rota pela CE-010 evitando BR-116 por lentidão.',
      km: '30,417',
      time: 2280
    };

    const finalData = adaptWebhookCompletedToFinalData(webhookPayload, '2026-10-01T11:00:00.000Z');
    expect(finalData).not.toBeNull();
    expect(finalData?.bookingId).toBe('41976288');
    expect(finalData?.rideValue).toBe(129.6);
    expect(finalData?.serviceValue).toBe(126.46); // 129.60 - 3.14
    expect(finalData?.stoppedTimeSeconds).toBe(287);
    expect(finalData?.stoppedTimeFormatted).toBe('00:04:47');
    expect(finalData?.km).toBe(30.417);
    expect(finalData?.driverComment).toBe('Rota pela CE-010 evitando BR-116 por lentidão.');
  });

  it('adapta retorno do endpoint details com números em vírgula e tempo HH:MM:SS', () => {
    const detailsData = {
      ride_value: '104,39',
      service_value: '92,72',
      stopped_time: '00:15:30',
      stopped_time_value: '11,67',
      tollgate_fare: '0,00',
      parking_fare: '0,00',
      discount_value: '0,00',
      km: '21,795',
      time_in_seconds: '1850'
    };

    const finalData = adaptDetailsToFinalData('41867375', detailsData);
    expect(finalData).not.toBeNull();
    expect(finalData?.rideValue).toBe(104.39);
    expect(finalData?.serviceValue).toBe(92.72);
    expect(finalData?.stoppedTimeSeconds).toBe(930);
    expect(finalData?.km).toBe(21.795);
  });

  it('respeita a hierarquia: justificativa aprovada > driver_comment (webhook) > TX20', () => {
    const txRec = {
      qru: '1187684',
      evoucher: '41976288',
      justificativaTX20: 'Anotação da planilha TX20',
      obsMoto: ''
    };

    // 1. Quando há justificativa aprovada, ela vence todas
    const res1 = resolveDriverNotePriority({
      approvedJustification: 'Justificativa final revisada pela auditoria',
      webhookDriverComment: 'Comentário do webhook',
      hasWebhookEvent: true,
      tx20Record: txRec
    });
    expect(res1.source).toBe('approved_justification');
    expect(res1.effectiveJustification).toBe('Justificativa final revisada pela auditoria');

    // 2. Sem justificativa aprovada, driver_comment do webhook vence TX20
    const res2 = resolveDriverNotePriority({
      approvedJustification: '',
      webhookDriverComment: 'Comentário do webhook',
      hasWebhookEvent: true,
      tx20Record: txRec
    });
    expect(res2.source).toBe('webhook_driver_comment');
    expect(res2.effectiveJustification).toBe('Comentário do webhook');

    // 3. Sem webhook comment, usa TX20 (e detecta cancelamento na Coluna AY)
    const res3 = resolveDriverNotePriority({
      approvedJustification: '',
      webhookDriverComment: '',
      hasWebhookEvent: false,
      tx20Record: { ...txRec, obsMoto: '[Sistema - Cliente Solicitou Cancelamento]' }
    });
    expect(res3.source).toBe('tx20_cancelled');
    expect(res3.effectiveJustification).toBe(CANCELLED_CONTESTATION_TEXT);
  });

  it('marca anotação indisponível via API quando não há evento de webhook e NÃO dispara alerta de ausência de anotação', () => {
    const reportItem = {
      booking_id: '41990001',
      service_id: '1190001',
      real_distance: '15.000',
      estimate_distance: '14.500',
      real_fare: '60.00',
      estimate_fare: '58.00',
      status_name: 'Finalizada'
    };

    const ride = adaptReportItemToRide(reportItem, {
      finalData: null,
      tx20Record: null,
      approvedJustification: null
    });

    expect(ride).not.toBeNull();
    expect(ride?.driverNoteSource).toBe('unavailable_via_api');
    expect(ride?.driverNoteStatusLabel).toContain('Anotação indisponível via API');

    const risk = evaluateRideRisk(ride!);
    expect(risk.driverNoteUnavailableViaApi).toBe(true);
    expect(risk.reasons.some(r => r.includes('não registrou justificativa'))).toBe(false);
  });
});
