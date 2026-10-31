import React, { useState } from 'react';
import { Lock, User, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { loginWithPassword } from '../services/apiClient';

interface LoginScreenProps {
  onLoginSuccess: (operatorName: string) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [operatorName, setOperatorName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (operatorName.trim().length < 2) {
      setError('Informe o nome do operador (mínimo 2 caracteres).');
      return;
    }
    if (!password) {
      setError('Informe a senha de acesso.');
      return;
    }

    setLoading(true);
    try {
      const result = await loginWithPassword(operatorName.trim(), password);
      if (!result.ok) {
        setError(result.error || 'Credenciais inválidas ou acesso temporariamente bloqueado.');
      } else {
        onLoginSuccess(result.operatorName || operatorName.trim());
      }
    } catch {
      setError('Falha de comunicação com o servidor de autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        padding: '24px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '32px 28px',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.06)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <img
            src="./logo.png"
            alt="Táxi 2.0"
            style={{ width: '48px', height: '48px', borderRadius: '10px', objectFit: 'contain' }}
          />
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Táxi 2.0 • Medição Petrobras
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '2px 0 0 0' }}>
              Contrato SAP 4600686169 • Acesso Restrito
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={15} />
              <span>Nome do Operador</span>
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex.: Eduardo Fernandes"
              value={operatorName}
              onChange={e => setOperatorName(e.target.value)}
              disabled={loading}
              autoComplete="name"
              required
            />
            <p className="form-hint" style={{ marginTop: '4px' }}>
              Identificação registrada no histórico de auditoria (audit_log).
            </p>
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lock size={15} />
              <span>Senha de Acesso</span>
            </label>
            <input
              type="password"
              className="form-control"
              placeholder="Digite a senha do sistema..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.83rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}
          >
            {loading ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Autenticando...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Entrar no Painel de Conciliação</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
