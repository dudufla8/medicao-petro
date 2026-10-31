import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  Calendar,
  MessageSquare
} from 'lucide-react';
import {
  fetchWebhookEvents,
  type WebhookDailyCounter,
  type WebhookEventSummary
} from '../services/apiClient';

interface WebhookEventsModalProps {
  open: boolean;
  onClose: () => void;
}

export function WebhookEventsModal({ open, onClose }: WebhookEventsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<WebhookEventSummary[]>([]);
  const [dailyCounters, setDailyCounters] = useState<WebhookDailyCounter[]>([]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchWebhookEvents();
      setEvents(res.events);
      setDailyCounters(res.dailyCounters);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar eventos do webhook.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  if (!open) return null;

  const formatBrDateTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '880px', width: '95%', maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Activity size={20} style={{ color: '#0284c7' }} />
            <div>
              <h2 style={{ margin: 0 }}>Eventos do Webhook (Táxi Digital)</h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Últimos 50 eventos de status recebidos em tempo real (sem dados pessoais • LGPD)
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={loadData}
              disabled={loading}
              title="Atualizar lista de eventos"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Atualizar</span>
            </button>
            <button className="modal-close" onClick={onClose} title="Fechar">
              <X size={20} />
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '12px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.85rem'
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Contadores por Dia */}
        <div style={{ marginBottom: '20px' }}>
          <h3
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Calendar size={15} />
            <span>Contadores de Eventos por Dia</span>
          </h3>

          {dailyCounters.length === 0 && !loading ? (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                fontSize: '0.84rem',
                color: '#64748b',
                textAlign: 'center'
              }}
            >
              Nenhum evento registrado até o momento.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                gap: '10px'
              }}
            >
              {dailyCounters.map(day => (
                <div
                  key={day.date}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '10px 12px'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                    {day.date}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '4px' }}>
                    Total: <strong>{day.total}</strong> • Concluídas (5):{' '}
                    <strong style={{ color: '#15803d' }}>{day.completed}</strong>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#0369a1', marginTop: '2px' }}>
                    Com driver_comment: <strong>{day.withDriverComment}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabela dos Últimos 50 Eventos */}
        <div>
          <h3
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <MessageSquare size={15} />
            <span>Últimos 50 Eventos Recebidos</span>
          </h3>

          {loading && events.length === 0 ? (
            <div style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
              Carregando eventos...
            </div>
          ) : events.length === 0 ? (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '24px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.86rem'
              }}
            >
              Nenhum evento de status recebido ainda (eventos de teste 999999999 ficam ocultos automaticamente).
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.83rem',
                  textAlign: 'left'
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 12px', color: '#334155' }}>Recebido em (BRT)</th>
                    <th style={{ padding: '10px 12px', color: '#334155' }}>Booking ID (eVoucher)</th>
                    <th style={{ padding: '10px 12px', color: '#334155' }}>Código / Status</th>
                    <th style={{ padding: '10px 12px', color: '#334155' }}>Comentário Motorista</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '9px 12px', color: '#475569' }}>
                        {formatBrDateTime(ev.receivedAt)}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: '#0f172a' }}>
                        {ev.bookingId || '-'}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span
                          className="badge-pill"
                          style={{
                            background:
                              ev.code === 'completed' || ev.status === 5 ? '#dcfce7' : '#e0f2fe',
                            color:
                              ev.code === 'completed' || ev.status === 5 ? '#15803d' : '#0369a1'
                          }}
                        >
                          {ev.code || 'status'} {ev.status !== null ? `(#${ev.status})` : ''}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {ev.hasDriverComment ? (
                          <span
                            style={{
                              color: '#15803d',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <CheckCircle2 size={14} /> Sim
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Não</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
