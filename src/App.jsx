import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Settings, 
  Search, 
  RefreshCw, 
  Car, 
  ShieldAlert, 
  Check, 
  Copy, 
  Database, 
  X, 
  RotateCcw,
  ListTodo,
  CheckCheck,
  Zap,
  ArrowRight,
  Activity,
  LogOut
} from 'lucide-react';
import { parseSistemaTX20, parseMedicaoWorkbook, exportUpdatedWorkbook } from './services/excelProcessor';
import { evaluateJustificationQuality } from './services/analyzer';
import { generateGeminiJustification } from './services/gemini';
import { checkSession, logoutSession, getStoredOperatorName } from './services/apiClient';
import { LoginScreen } from './ui/LoginScreen';
import { WebhookEventsModal } from './ui/WebhookEventsModal';

export default function App() {
  // Estados de Autenticação e Sessão
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [operatorName, setOperatorName] = useState(() => getStoredOperatorName() || '');
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);

  // Estados de Arquivos
  const [tx20Map, setTx20Map] = useState(null);
  const [tx20FileName, setTx20FileName] = useState('');
  const [medicaoWb, setMedicaoWb] = useState(null);
  const [medicaoFileName, setMedicaoFileName] = useState('');
  const [rides, setRides] = useState([]);
  
  // Estados de Interface e Fila de Trabalho
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [queueTab, setQueueTab] = useState('pending'); // 'pending' | 'completed' | 'all'
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiGeneratingId, setAiGeneratingId] = useState(null);
  const [copiedVoucher, setCopiedVoucher] = useState(null);

  const fileInputRefMedicao = useRef(null);
  const fileInputRefTx20 = useRef(null);

  useEffect(() => {
    let active = true;
    checkSession().then(info => {
      if (!active) return;
      setIsAuthenticated(info.authenticated);
      if (info.operatorName) {
        setOperatorName(info.operatorName);
      }
      setAuthChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Copiar número do voucher para a área de transferência
  const handleCopyVoucher = (voucherText) => {
    if (!voucherText) return;
    navigator.clipboard.writeText(voucherText);
    setCopiedVoucher(voucherText);
    setTimeout(() => {
      setCopiedVoucher(null);
    }, 2000);
  };

  const handleLogout = async () => {
    await logoutSession();
    setIsAuthenticated(false);
    setOperatorName('');
  };

  // Carregamento do arquivo TX20
  const handleTx20Upload = async (file) => {
    if (!file) return;
    setLoading(true);
    setLoadingMsg('Processando base do Sistema TX20 (26 mil+ corridas)...');
    try {
      const buffer = await file.arrayBuffer();
      const map = parseSistemaTX20(buffer);
      setTx20Map(map);
      setTx20FileName(file.name);

      if (medicaoWb) {
        setLoadingMsg('Recruzando dados com a medição aberta...');
        setRides(prevRides => prevRides.map(r => {
          const key = r.qru ? `qru_${r.qru}` : `ev_${r.evoucher}`;
          const txRec = map.get(key) || (r.evoucher ? map.get(`ev_${r.evoucher}`) : null);
          if (txRec && !r.currentJustification) {
            const raw = txRec.justificativaTX20 || '';
            const newJust = txRec.obsMoto?.toLowerCase().includes('cancel') 
              ? 'CORRIDA CANCELADA - NÃO PODE TER DESCONTO DE VALOR DE CORRIDA DESCONTADA POIS NÃO COLOCAMOS ESSAS CORRIDAS NA MEDIÇÃO'
              : raw;
            return {
              ...r,
              rawJustification: raw,
              obsMoto: txRec.obsMoto || '',
              currentJustification: newJust,
              isAutoFilled: true,
              quality: evaluateJustificationQuality(newJust)
            };
          }
          return r;
        }));
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar planilha do Sistema TX20: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Carregamento da Planilha de Medição Petrobras
  const handleMedicaoUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setLoadingMsg('Lendo planilha de medição Petrobras e buscando pendências...');
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseMedicaoWorkbook(buffer, tx20Map);
      setMedicaoWb(parsed.workbook);
      setMedicaoFileName(file.name);
      setRides(parsed.rides);
      setQueueTab('pending'); // Volta automaticamente para a fila de trabalho
    } catch (err) {
      console.error(err);
      alert('Erro ao processar planilha de medição: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Atualização de Justificativa
  const handleUpdateJustification = (rideId, text) => {
    setRides(prev => prev.map(r => {
      if (r.id === rideId) {
        return {
          ...r,
          currentJustification: text,
          quality: evaluateJustificationQuality(text)
        };
      }
      return r;
    }));
  };

  // Marcar Corrida como Concluída / Validada ou Reabrir
  const handleToggleComplete = (rideId) => {
    setRides(prev => prev.map(r => {
      if (r.id === rideId) {
        const nextCompleted = !r.isCompleted;
        return {
          ...r,
          isCompleted: nextCompleted,
          pagamento: nextCompleted ? 'LIBERADO PAGAMENTO' : r.pagamento
        };
      }
      return r;
    }));
  };

  // Ação em Lote: Aprovar e Arquivar todas com Padrão Aprovado (Forte)
  const handleBulkApproveStrong = () => {
    const readyCount = rides.filter(r => !r.isCompleted && r.quality?.score === 'strong').length;
    if (readyCount === 0) {
      alert('Nenhuma corrida pendente com padrão forte para aprovar em lote.');
      return;
    }
    setRides(prev => prev.map(r => {
      if (!r.isCompleted && r.quality?.score === 'strong') {
        return { ...r, isCompleted: true, pagamento: 'LIBERADO PAGAMENTO' };
      }
      return r;
    }));
  };

  // Atualização do Status de Pagamento
  const handleTogglePagamento = (rideId) => {
    setRides(prev => prev.map(r => {
      if (r.id === rideId) {
        const nextStatus = r.pagamento === 'LIBERADO PAGAMENTO' ? 'EM ANÁLISE' : 'LIBERADO PAGAMENTO';
        return { ...r, pagamento: nextStatus };
      }
      return r;
    }));
  };

  // Presets Rápidos
  const handleApplyPreset = (ride, presetType) => {
    let text = '';
    const passageiro = ride.passageiro ? `junto ao passageiro (${ride.passageiro})` : 'com o passageiro';
    
    switch (presetType) {
      case 'transito':
        text = `Desvio de rota indicado via GPS em decorrência de retenção e lentidão acentuada nas vias convencionais. Percurso alternativo realizado de comum acordo ${passageiro} visando a pontualidade.`;
        break;
      case 'passageiro':
        text = `Alteração do trajeto efetuada a pedido expresso do passageiro para atendimento de necessidade de serviço durante o deslocamento.`;
        break;
      case 'portaria':
        text = `Atendimento concluído na portaria de segurança / posto de vigilância da unidade por restrição de acesso interno à área operacional.`;
        break;
      case 'cancelada':
        text = `CORRIDA CANCELADA - NÃO PODE TER DESCONTO DE VALOR DE CORRIDA DESCONTADA POIS NÃO COLOCAMOS ESSAS CORRIDAS NA MEDIÇÃO`;
        break;
      case 'pedagio':
        text = `Valor de pedágio devido conforme regras e previsão contratual para o deslocamento intermunicipal autorizado.`;
        break;
      default:
        break;
    }

    if (text) {
      handleUpdateJustification(ride.id, text);
    }
  };

  // Chamada de IA Gemini via Backend (/api/gemini/improve) com Regras Estritas Anti-Alucinação
  const handleAiEnrich = async (ride) => {
    setAiGeneratingId(ride.id);
    try {
      const generated = await generateGeminiJustification(ride);
      handleUpdateJustification(ride.id, generated);
    } catch (err) {
      console.error(err);
      alert('Erro na IA Gemini: ' + (err.message || 'Falha ao consultar a rota /api/gemini/improve.'));
    } finally {
      setAiGeneratingId(null);
    }
  };

  // Exportar Planilha Atualizada
  const handleExport = () => {
    if (!medicaoWb || rides.length === 0) {
      alert('Carregue uma planilha de medição antes de exportar.');
      return;
    }
    try {
      exportUpdatedWorkbook(medicaoWb, rides, medicaoFileName);
    } catch (err) {
      console.error(err);
      alert('Erro ao exportar planilha: ' + err.message);
    }
  };

  // Métricas e KPIs
  const stats = useMemo(() => {
    const total = rides.length;
    const completedCount = rides.filter(r => r.isCompleted).length;
    const pendingCount = total - completedCount;
    const manualCount = rides.filter(r => r.manualCheck?.isManual).length;
    const strongCount = rides.filter(r => r.quality?.score === 'strong').length;
    const mediumCount = rides.filter(r => r.quality?.score === 'medium').length;
    const weakCount = rides.filter(r => r.quality?.score === 'weak').length;
    const autoFilledCount = rides.filter(r => r.isAutoFilled).length;
    const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    const readyStrongPendingCount = rides.filter(r => !r.isCompleted && r.quality?.score === 'strong').length;

    return { 
      total, 
      completedCount, 
      pendingCount, 
      manualCount, 
      strongCount, 
      mediumCount, 
      weakCount, 
      autoFilledCount,
      progressPercent,
      readyStrongPendingCount
    };
  }, [rides]);

  // Lista Filtrada com Suporte a Fila de Pendências
  const filteredRides = useMemo(() => {
    return rides.filter(r => {
      // Filtro primário da fila de trabalho
      if (queueTab === 'pending' && r.isCompleted) return false;
      if (queueTab === 'completed' && !r.isCompleted) return false;

      // Filtros secundários
      if (activeFilter === 'manual' && !r.manualCheck?.isManual) return false;
      if (activeFilter === 'weak' && r.quality?.score !== 'weak') return false;
      if (activeFilter === 'strong' && r.quality?.score !== 'strong') return false;
      if (activeFilter === 'mobicity' && r.system !== 'MOBICITY') return false;
      if (activeFilter === 'simcorpi' && r.system !== 'SIMCORPI') return false;

      // Busca textual
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const fullText = `${r.evoucher} ${r.qru} ${r.passageiro} ${r.motorista} ${r.placa} ${r.cidadeOrigem} ${r.cidadeDestino} ${r.validacaoAnalista} ${r.currentJustification}`.toLowerCase();
        if (!fullText.includes(q)) return false;
      }

      return true;
    });
  }, [rides, queueTab, activeFilter, searchQuery]);

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#475569', gap: '10px' }}>
        <RefreshCw size={18} className="animate-spin" />
        <span>Verificando sessão segura...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLoginSuccess={(name) => {
          setOperatorName(name);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="app-container">
      {/* Header Superior Corporativo B2B */}
      <header className="app-header">
        <div className="brand-wrapper">
          <img src="./logo.png" alt="Táxi 2.0" className="brand-logo-img" />
          <div className="brand-titles">
            <h1>
              Táxi 2.0 <span className="brand-badge">Petrobras • Medição B2B</span>
            </h1>
            <p>
              Auditoria operacional de corridas, conciliação de glosas e validação de rotas
              {operatorName ? ` • Operador: ${operatorName}` : ''}
            </p>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setWebhookModalOpen(true)}
            title="Monitorar eventos recebidos via Webhook da Táxi Digital"
          >
            <Activity size={18} />
            <span>Eventos do Webhook</span>
          </button>

          <button 
            className="btn btn-secondary" 
            onClick={() => setSettingsOpen(true)}
            title="Configurações do Sistema"
          >
            <Settings size={18} />
            <span>Configurações</span>
          </button>

          <button 
            className="btn btn-primary" 
            onClick={handleExport}
            disabled={rides.length === 0}
            title="Exportar planilha final para reenvio à Petrobras"
          >
            <Download size={18} />
            <span>Exportar Planilha Respondida</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleLogout}
            title="Encerrar sessão"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Áreas de Upload (2 Colunas) */}
      <div className="upload-grid">
        {/* Card 1: Base TX20 */}
        <div 
          className={`dropzone-card ${tx20Map ? 'loaded' : ''}`}
          onClick={() => fileInputRefTx20.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRefTx20} 
            style={{ display: 'none' }} 
            accept=".xlsx, .xls" 
            onChange={e => handleTx20Upload(e.target.files?.[0])}
          />
          <div className="dropzone-icon">
            <Database size={22} />
          </div>
          <div className="dropzone-title">
            {tx20Map ? 'Base do Sistema TX20 Carregada' : '1. Carregar Base Operacional TX20'}
          </div>
          <div className="dropzone-subtitle">
            {tx20Map 
              ? `${tx20FileName} (${tx20Map.size} corridas indexadas)` 
              : 'Arquivo "sistema tx20 ... .xlsx" com as notas da Coluna CI'}
          </div>
          {tx20Map && (
            <div className="dropzone-file-info">
              <Check size={16} /> Base ativa para cruzamento automático
            </div>
          )}
        </div>

        {/* Card 2: Medição Petrobras */}
        <div 
          className={`dropzone-card ${medicaoWb ? 'loaded' : ''}`}
          onClick={() => fileInputRefMedicao.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRefMedicao} 
            style={{ display: 'none' }} 
            accept=".xlsx, .xls" 
            onChange={e => handleMedicaoUpload(e.target.files?.[0])}
          />
          <div className="dropzone-icon">
            <FileSpreadsheet size={22} />
          </div>
          <div className="dropzone-title">
            {medicaoWb ? 'Medição Petrobras Aberta' : '2. Carregar Planilha de Medição (MC)'}
          </div>
          <div className="dropzone-subtitle">
            {medicaoWb 
              ? `${medicaoFileName} (${rides.length} corridas apontadas)` 
              : 'Planilha enviada pelo fiscal com as abas de apontamentos Mobicity / Simcorpi'}
          </div>
          {medicaoWb && (
            <div className="dropzone-file-info">
              <Check size={16} /> Pronta para conciliação e exportação
            </div>
          )}
        </div>
      </div>

      {/* Loading Banner */}
      {loading && (
        <div style={{
          padding: '14px 18px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#15803d',
          fontWeight: 600,
          fontSize: '0.9rem'
        }}>
          <RefreshCw size={18} className="animate-spin" />
          <span>{loadingMsg}</span>
        </div>
      )}

      {/* Conteúdo Principal pós-carregamento */}
      {rides.length > 0 && (
        <>
          {/* Card de Progresso da Conciliação */}
          <div className="progress-card">
            <div className="progress-header">
              <div className="progress-title">
                <CheckCheck size={18} style={{ color: '#10b981' }} />
                <span>Progresso da Validação da Medição</span>
              </div>
              <div className="progress-stats-text">
                <strong>{stats.completedCount}</strong> de {stats.total} corridas concluídas ({stats.progressPercent}%) • <span style={{ color: '#b45309' }}>{stats.pendingCount} na fila</span>
              </div>
            </div>
            <div className="progress-bar-track">
              <div 
                className="progress-bar-indicator" 
                style={{ width: `${stats.progressPercent}%` }}
              />
            </div>
          </div>

          {/* KPIs / Sumário Executivo */}
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-icon-box" style={{ background: '#f1f5f9', color: '#0f172a' }}>
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <div className="kpi-val">{stats.total}</div>
                <div className="kpi-label">Total Apontadas</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: '#bfdbfe' }}>
              <div className="kpi-icon-box" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                <ShieldAlert size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#1d4ed8' }}>{stats.manualCount}</div>
                <div className="kpi-label">Requerem Análise</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: '#fecaca' }}>
              <div className="kpi-icon-box" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                <AlertCircle size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#b91c1c' }}>{stats.weakCount}</div>
                <div className="kpi-label">Justificativas Fracas</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: '#bbf7d0' }}>
              <div className="kpi-icon-box" style={{ background: '#f0fdf4', color: '#15803d' }}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#15803d' }}>{stats.strongCount}</div>
                <div className="kpi-label">Padrão Aprovado</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: '#e2e8f0' }}>
              <div className="kpi-icon-box" style={{ background: '#f1f5f9', color: '#0891b2' }}>
                <Sparkles size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#0891b2' }}>{stats.autoFilledCount}</div>
                <div className="kpi-label">Preenchidas TX20</div>
              </div>
            </div>
          </div>

          {/* Abas Primárias de Fluxo (Fila de Trabalho vs Concluídas) e Ação em Lote */}
          <div className="queue-tabs-row">
            <div className="queue-nav-group">
              <button 
                className={`queue-tab-btn ${queueTab === 'pending' ? 'active' : ''}`}
                onClick={() => setQueueTab('pending')}
              >
                <ListTodo size={16} />
                <span>Fila de Pendências</span>
                <span className="queue-tab-count">{stats.pendingCount}</span>
              </button>

              <button 
                className={`queue-tab-btn ${queueTab === 'completed' ? 'active' : ''}`}
                onClick={() => setQueueTab('completed')}
              >
                <CheckCircle2 size={16} />
                <span>Concluídas</span>
                <span className="queue-tab-count">{stats.completedCount}</span>
              </button>

              <button 
                className={`queue-tab-btn ${queueTab === 'all' ? 'active' : ''}`}
                onClick={() => setQueueTab('all')}
              >
                <span>Todas as Corridas</span>
                <span className="queue-tab-count">{stats.total}</span>
              </button>
            </div>

            {/* Ação Rápida em Lote */}
            {stats.readyStrongPendingCount > 0 && queueTab === 'pending' && (
              <button 
                className="btn-bulk-approve"
                onClick={handleBulkApproveStrong}
                title="Aprova e arquiva todas as corridas que já estão com justificativas fortes e aprovadas"
              >
                <Zap size={15} />
                <span>Aprovar e Arquivar Prontas em Lote ({stats.readyStrongPendingCount})</span>
              </button>
            )}
          </div>

          {/* Barra de Filtros e Busca */}
          <div className="controls-bar">
            <div className="filter-group">
              <button 
                className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setActiveFilter('all')}
              >
                Todos os Filtros
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'manual' ? 'active' : ''}`}
                onClick={() => setActiveFilter('manual')}
                style={stats.manualCount > 0 ? { borderColor: '#bfdbfe', color: '#1d4ed8' } : {}}
              >
                <ShieldAlert size={14} /> Requerem Análise ({stats.manualCount})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'weak' ? 'active' : ''}`}
                onClick={() => setActiveFilter('weak')}
                style={stats.weakCount > 0 ? { borderColor: '#fecaca', color: '#b91c1c' } : {}}
              >
                <AlertCircle size={14} /> Fracas ({stats.weakCount})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'strong' ? 'active' : ''}`}
                onClick={() => setActiveFilter('strong')}
              >
                <CheckCircle2 size={14} /> Aprovadas ({stats.strongCount})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'mobicity' ? 'active' : ''}`}
                onClick={() => setActiveFilter('mobicity')}
              >
                Mobicity
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'simcorpi' ? 'active' : ''}`}
                onClick={() => setActiveFilter('simcorpi')}
              >
                Simcorpi
              </button>
            </div>

            <div className="search-input-wrapper">
              <Search size={16} />
              <input 
                type="text" 
                className="search-input"
                placeholder="Buscar por Voucher, QRU, Motorista, Passageiro..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Estado Inbox Zero (Quando todas as pendências foram concluídas) */}
          {queueTab === 'pending' && filteredRides.length === 0 && stats.total > 0 && (
            <div className="inbox-zero-box">
              <div className="inbox-zero-icon">
                <CheckCircle2 size={32} />
              </div>
              <div className="inbox-zero-title">Fila de Pendências Zerada! 🎉</div>
              <p className="inbox-zero-subtitle">
                Todas as corridas apontadas nesta medição foram analisadas, justificadas e aprovadas com sucesso.
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                <button className="btn btn-primary" onClick={handleExport}>
                  <Download size={16} /> Exportar Planilha Respondida (.xlsx)
                </button>
                <button className="btn btn-secondary" onClick={() => setQueueTab('completed')}>
                  Ver Corridas Concluídas ({stats.completedCount})
                </button>
              </div>
            </div>
          )}

          {/* Lista de Corridas (Cards Fluidos com Grid Interno B2B) */}
          <div className="cards-list">
            {filteredRides.map(ride => {
              const quality = ride.quality;
              const manualCheck = ride.manualCheck;
              const voucherNumber = ride.evoucher || ride.qru || '';
              const isCopied = copiedVoucher === voucherNumber;

              return (
                <div key={ride.id} className="ride-card">
                  <div className="card-grid-layout">
                    
                    {/* COLUNA 1: Identificação, Trajeto Visual e Apontamento Fiscal */}
                    <div className="col-identification">
                      <div className="ride-id-badges">
                        <span className={`badge-pill ${ride.system === 'MOBICITY' ? 'badge-source-mobicity' : 'badge-source-simcorpi'}`}>
                          {ride.system}
                        </span>

                        {voucherNumber && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
                              Voucher: {voucherNumber}
                            </span>
                            <button 
                              className={`btn-copy ${isCopied ? 'copied' : ''}`}
                              onClick={() => handleCopyVoucher(voucherNumber)}
                              title="Copiar número do voucher"
                            >
                              {isCopied ? <Check size={12} /> : <Copy size={12} />}
                              <span>{isCopied ? 'Copiado!' : 'Copiar'}</span>
                            </button>
                          </div>
                        )}

                        {ride.qru && ride.system !== 'MOBICITY' && (
                          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            QRU: <strong>{ride.qru}</strong>
                          </span>
                        )}

                        {ride.isAutoFilled && (
                          <span className="badge-pill" style={{ background: '#f0fdfa', color: '#0d9488', border: '1px solid #99f6e4' }}>
                            <Sparkles size={11} /> TX20
                          </span>
                        )}

                        {ride.isCompleted && (
                          <span className="badge-pill" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
                            <Check size={11} /> Concluída
                          </span>
                        )}
                      </div>

                      {/* Indicadores de Trajeto com Linha Tracejada */}
                      <div className="route-timeline-container">
                        <div className="route-bullets-line">
                          <div className="bullet-origin" title="Origem" />
                          <div className="line-dashed" />
                          <div className="bullet-dest" title="Destino" />
                        </div>
                        <div className="route-text-points">
                          <div>
                            <div className="route-city">{ride.cidadeOrigem || 'Origem'}</div>
                            <span className="route-detail">{ride.origem || 'Endereço de embarque'}</span>
                          </div>
                          <div>
                            <div className="route-city">{ride.cidadeDestino || 'Destino'}</div>
                            <span className="route-detail">{ride.destino || 'Endereço de desembarque'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Destaque de Glosa / Apontamento do Fiscal (Âmbar Suave) */}
                      <div className="fiscal-glosa-box">
                        <AlertTriangle size={18} />
                        <div>
                          <strong>Apontamento do Fiscal:</strong> {ride.validacaoAnalista || ride.validacaoApoio}
                        </div>
                      </div>
                    </div>

                    {/* COLUNA 2: Métricas Numéricas Centralizadas */}
                    <div className="col-metrics">
                      <div className="metrics-box-grid">
                        <div className="metric-cell">
                          <span className="metric-cell-label">Quilometragem</span>
                          <span className="metric-cell-val">Real: {ride.kmReal} km</span>
                          <span className="metric-cell-sub">Previsto: {ride.kmEstimado} km</span>
                          {parseFloat(ride.kmEstimado) > 0 && (
                            <span className="metric-diff-bad" style={{ fontSize: '0.74rem' }}>
                              Δ: +{(parseFloat(ride.kmReal) - parseFloat(ride.kmEstimado)).toFixed(1)} km ({((parseFloat(ride.kmReal) / parseFloat(ride.kmEstimado) - 1) * 100).toFixed(0)}%)
                            </span>
                          )}
                        </div>

                        <div className="metric-cell">
                          <span className="metric-cell-label">Faturamento</span>
                          <span className="metric-cell-val">R$ {parseFloat(ride.valorTotal || 0).toFixed(2)}</span>
                          <span className="metric-cell-sub">Orçado: R$ {parseFloat(ride.valorEstimado || 0).toFixed(2)}</span>
                          {ride.custoEspera > 0 && (
                            <span style={{ fontSize: '0.74rem', color: '#b45309' }}>
                              HP: R$ {ride.custoEspera}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="driver-info-cell">
                        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '2px' }}>
                          Passageiro: {ride.passageiro || 'Passageiro Petrobras'}
                        </div>
                        <div style={{ color: '#64748b' }}>
                          Motorista: {ride.motorista} • Placa: <strong>{ride.placa}</strong>
                        </div>
                      </div>
                    </div>

                    {/* COLUNA 3: Registro TX20, Justificativa e Ações IA */}
                    <div className="col-actions">
                      {/* Registro Original do Motorista no TX20 */}
                      {ride.rawJustification && (
                        <div className="system-driver-note">
                          <strong>Registro no TX20 (Coluna CI):</strong> "{ride.rawJustification}"
                        </div>
                      )}

                      {/* Alerta de Análise Manual */}
                      {manualCheck.isManual && (
                        <div className="manual-alert-banner">
                          <ShieldAlert size={16} />
                          <div>
                            <strong>Requer Análise Manual:</strong> {manualCheck.reasons.join(' | ')}
                          </div>
                        </div>
                      )}

                      {/* Área da Justificativa da Empresa */}
                      <div>
                        <div className="justification-label-bar">
                          <span>Justificativa da Empresa (Será gravada na medição final):</span>
                          <span className={`badge-pill badge-score-${quality.score}`}>
                            {quality.label}
                          </span>
                        </div>

                        <textarea
                          className="justification-textarea"
                          value={ride.currentJustification || ''}
                          placeholder="Digite a justificativa técnica estrita ou selecione um atalho abaixo..."
                          onChange={e => handleUpdateJustification(ride.id, e.target.value)}
                        />
                      </div>

                      {/* Linha de Atalhos, Botão IA e Validação */}
                      <div className="bottom-controls-row">
                        <div className="presets-group">
                          <button 
                            className="preset-btn"
                            onClick={() => handleApplyPreset(ride, 'transito')}
                            title="Desvio por trânsito indicado via GPS"
                          >
                            Trânsito/GPS
                          </button>

                          <button 
                            className="preset-btn"
                            onClick={() => handleApplyPreset(ride, 'passageiro')}
                            title="Solicitação expressa do passageiro"
                          >
                            Pedido Cliente
                          </button>

                          <button 
                            className="preset-btn"
                            onClick={() => handleApplyPreset(ride, 'portaria')}
                            title="Desembarque na portaria / posto de vigilância"
                          >
                            Portaria/PV
                          </button>

                          <button 
                            className="preset-btn"
                            onClick={() => handleApplyPreset(ride, 'cancelada')}
                            title="Corrida cancelada sem cobrança"
                          >
                            Cancelada
                          </button>

                          <button 
                            className="preset-btn"
                            onClick={() => handleApplyPreset(ride, 'pedagio')}
                            title="Pedágio conforme contrato"
                          >
                            Pedágio
                          </button>
                        </div>

                        <div className="action-buttons-group">
                          <button 
                            className="btn btn-ai"
                            disabled={aiGeneratingId === ride.id}
                            onClick={() => handleAiEnrich(ride)}
                            title="Gerar justificativa formal estrita com Gemini AI"
                          >
                            {aiGeneratingId === ride.id ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" />
                                <span>Auditando...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles size={14} />
                                <span>Melhorar com IA</span>
                              </>
                            )}
                          </button>

                          {/* Botão de Validação / Conclusão (Remove da Fila de Trabalho) */}
                          {!ride.isCompleted ? (
                            <button 
                              className="btn-approve-complete"
                              onClick={() => handleToggleComplete(ride.id)}
                              title="Valida a corrida, marca liberado pagamento e remove da fila ativa de pendências"
                            >
                              <CheckCircle2 size={15} />
                              <span>Concluir</span>
                            </button>
                          ) : (
                            <button 
                              className="btn-reopen-complete"
                              onClick={() => handleToggleComplete(ride.id)}
                              title="Reabrir esta corrida e trazê-la de volta para a fila de pendências"
                            >
                              <RotateCcw size={14} />
                              <span>Reabrir</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal de Eventos do Webhook */}
      <WebhookEventsModal
        open={webhookModalOpen}
        onClose={() => setWebhookModalOpen(false)}
      />

      {/* Modal de Configurações */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Configurações do Sistema</h2>
              <button className="modal-close" onClick={() => setSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Segurança e Integrações de Servidor</label>
              <p className="form-hint" style={{ marginTop: 0 }}>
                As credenciais da API Táxi Digital, Webhook e Google Gemini são gerenciadas exclusivamente no servidor (variáveis de ambiente da Vercel), sem exposição no navegador.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Contrato e Dados de Faturamento</label>
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: '#334155'
              }}>
                <div><strong>Contrato SAP:</strong> 4600686169</div>
                <div><strong>Contratada:</strong> JESSICA BELLO DA SILVA - TAXI 2.0</div>
                <div><strong>Operador Autenticado:</strong> {operatorName || 'Operador'}</div>
                <div><strong>Destino do Deploy:</strong> https://taxidoispontozero.com.br/medicao-petro/</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
