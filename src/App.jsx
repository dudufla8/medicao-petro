import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  MapPin, 
  Car, 
  Clock, 
  ShieldAlert, 
  Check, 
  ChevronRight,
  Database,
  ExternalLink,
  HelpCircle,
  X
} from 'lucide-react';
import { parseSistemaTX20, parseMedicaoWorkbook, exportUpdatedWorkbook } from './services/excelProcessor';
import { evaluateJustificationQuality } from './services/analyzer';
import { generateGeminiJustification } from './services/gemini';

export default function App() {
  // Estados de Arquivos
  const [tx20Map, setTx20Map] = useState(null);
  const [tx20FileName, setTx20FileName] = useState('');
  const [medicaoWb, setMedicaoWb] = useState(null);
  const [medicaoFileName, setMedicaoFileName] = useState('');
  const [rides, setRides] = useState([]);
  
  // Estados de Interface
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || import.meta.env.VITE_GEMINI_API_KEY || '');
  const [aiGeneratingId, setAiGeneratingId] = useState(null);

  const fileInputRefMedicao = useRef(null);
  const fileInputRefTx20 = useRef(null);

  // Efeito para salvar API Key
  const handleSaveApiKey = (key) => {
    setGeminiApiKey(key);
    localStorage.setItem('GEMINI_API_KEY', key);
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

      // Se já houver medição carregada, recruza imediatamente
      if (medicaoWb) {
        setLoadingMsg('Recruzando dados com a medição aberta...');
        // Reprocessa
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
    } catch (err) {
      console.error(err);
      alert('Erro ao processar planilha de medição: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Atualização de Justificativa de uma Corrida
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

  // Chamada de IA Gemini para Enriquecer Justificativa
  const handleAiEnrich = async (ride) => {
    setAiGeneratingId(ride.id);
    try {
      const generated = await generateGeminiJustification(ride, geminiApiKey);
      handleUpdateJustification(ride.id, generated);
    } catch (err) {
      console.error(err);
      alert('Erro na IA Gemini: ' + (err.message || 'Verifique a chave da API nas configurações.'));
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
    const manualCount = rides.filter(r => r.manualCheck?.isManual).length;
    const strongCount = rides.filter(r => r.quality?.score === 'strong').length;
    const mediumCount = rides.filter(r => r.quality?.score === 'medium').length;
    const weakCount = rides.filter(r => r.quality?.score === 'weak').length;
    const autoFilledCount = rides.filter(r => r.isAutoFilled).length;

    return { total, manualCount, strongCount, mediumCount, weakCount, autoFilledCount };
  }, [rides]);

  // Lista Filtrada
  const filteredRides = useMemo(() => {
    return rides.filter(r => {
      // Filtro por categoria
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
  }, [rides, activeFilter, searchQuery]);

  return (
    <div className="app-container">
      {/* Header Superior */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo-icon">
            <Car size={26} />
          </div>
          <div className="brand-titles">
            <h1>
              Táxi 2.0 <span className="brand-badge">Petrobras • Medição</span>
            </h1>
            <p>Conciliação inteligente de glosas, auditoria de rotas e enriquecimento de justificativas</p>
          </div>
        </div>

        <div className="header-actions">
          <button 
            className="btn btn-secondary" 
            onClick={() => setSettingsOpen(true)}
            title="Configurações e Chaves de API"
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
            <Database size={24} />
          </div>
          <div className="dropzone-title">
            {tx20Map ? 'Base Sistema TX20 Carregada' : '1. Carregar Base do Sistema TX20'}
          </div>
          <div className="dropzone-subtitle">
            {tx20Map 
              ? `${tx20FileName} (${tx20Map.size} corridas indexadas)` 
              : 'Planilha "sistema tx20 ... .xlsx" com as notas da Coluna CI e motoristas'}
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
            <FileSpreadsheet size={24} />
          </div>
          <div className="dropzone-title">
            {medicaoWb ? 'Medição Petrobras Aberta' : '2. Carregar Planilha de Medição (MC)'}
          </div>
          <div className="dropzone-subtitle">
            {medicaoWb 
              ? `${medicaoFileName} (${rides.length} corridas apontadas)` 
              : 'Planilha recebida com as abas de Mobicity e Simcorpi a justificar'}
          </div>
          {medicaoWb && (
            <div className="dropzone-file-info">
              <Check size={16} /> Pronta para conciliação e exportação
            </div>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div style={{
          padding: '16px 20px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#34d399',
          fontWeight: 500
        }}>
          <RefreshCw size={20} className="animate-spin" />
          <span>{loadingMsg}</span>
        </div>
      )}

      {/* KPIs / Sumário Executivo */}
      {rides.length > 0 && (
        <>
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-icon-box" style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff' }}>
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <div className="kpi-val">{stats.total}</div>
                <div className="kpi-label">Glosas Apontadas</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: 'rgba(168, 85, 247, 0.3)' }}>
              <div className="kpi-icon-box" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
                <ShieldAlert size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#c084fc' }}>{stats.manualCount}</div>
                <div className="kpi-label">Requerem Análise Manual</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
              <div className="kpi-icon-box" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                <AlertCircle size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#f87171' }}>{stats.weakCount}</div>
                <div className="kpi-label">Justificativas Fracas</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
              <div className="kpi-icon-box" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#34d399' }}>{stats.strongCount}</div>
                <div className="kpi-label">Padrão Aprovado</div>
              </div>
            </div>

            <div className="kpi-card" style={{ borderColor: 'rgba(6, 182, 212, 0.3)' }}>
              <div className="kpi-icon-box" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee' }}>
                <Sparkles size={20} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#22d3ee' }}>{stats.autoFilledCount}</div>
                <div className="kpi-label">Preenchidas TX20</div>
              </div>
            </div>
          </div>

          {/* Barra de Filtros e Busca */}
          <div className="controls-bar">
            <div className="filter-group">
              <button 
                className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setActiveFilter('all')}
              >
                Todas ({stats.total})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'manual' ? 'active' : ''}`}
                onClick={() => setActiveFilter('manual')}
                style={stats.manualCount > 0 ? { borderColor: '#c084fc' } : {}}
              >
                <ShieldAlert size={14} /> Análise Manual ({stats.manualCount})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'weak' ? 'active' : ''}`}
                onClick={() => setActiveFilter('weak')}
                style={stats.weakCount > 0 ? { borderColor: '#f87171' } : {}}
              >
                <AlertCircle size={14} /> Fracas / Pendentes ({stats.weakCount})
              </button>

              <button 
                className={`filter-chip ${activeFilter === 'strong' ? 'active' : ''}`}
                onClick={() => setActiveFilter('strong')}
              >
                <CheckCircle2 size={14} /> Prontas ({stats.strongCount})
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

          {/* Lista de Corridas para Conciliação */}
          <div className="cards-list">
            {filteredRides.map(ride => {
              const quality = ride.quality;
              const manualCheck = ride.manualCheck;

              return (
                <div 
                  key={ride.id} 
                  className={`ride-card ${manualCheck.isManual ? 'is-manual' : quality.score === 'weak' ? 'is-weak' : 'is-strong'}`}
                >
                  {/* Cabeçalho da Corrida */}
                  <div className="ride-header">
                    <div className="ride-id-badges">
                      <span className={`badge-tag ${ride.system === 'MOBICITY' ? 'badge-source-mobicity' : 'badge-source-simcorpi'}`}>
                        {ride.system}
                      </span>

                      {ride.evoucher && (
                        <span className="badge-tag" style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff' }}>
                          Voucher: <strong>{ride.evoucher}</strong>
                        </span>
                      )}

                      {ride.qru && (
                        <span className="badge-tag" style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff' }}>
                          QRU: <strong>{ride.qru}</strong>
                        </span>
                      )}

                      <span className={`badge-tag badge-score-${quality.score}`}>
                        {quality.score === 'strong' && <CheckCircle2 size={13} />}
                        {quality.score === 'medium' && <AlertTriangle size={13} />}
                        {quality.score === 'weak' && <AlertCircle size={13} />}
                        {quality.label}
                      </span>

                      {manualCheck.isManual && (
                        <span className="badge-tag badge-alert-manual">
                          <ShieldAlert size={13} /> Requer Análise Manual no TX20
                        </span>
                      )}

                      {ride.isAutoFilled && (
                        <span className="badge-tag" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee' }}>
                          <Sparkles size={13} /> Auto-preenchida (TX20)
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button 
                        className={`btn btn-sm ${ride.pagamento === 'LIBERADO PAGAMENTO' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => handleTogglePagamento(ride.id)}
                      >
                        {ride.pagamento === 'LIBERADO PAGAMENTO' ? (
                          <>
                            <Check size={14} /> Liberado Pagamento
                          </>
                        ) : (
                          ride.pagamento
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Apontamento Oficial do Analista Petrobras */}
                  <div className="analyst-box">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>Apontamento do Analista:</strong> {ride.validacaoAnalista || ride.validacaoApoio}
                    </div>
                  </div>

                  {/* Alerta de Risco para Análise Manual */}
                  {manualCheck.isManual && (
                    <div className="manual-risk-box">
                      <ShieldAlert size={18} />
                      <div>
                        <strong>Motivo da Verificação Manual:</strong>
                        <ul style={{ paddingLeft: '18px', marginTop: '4px' }}>
                          {manualCheck.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Grid de Métricas da Corrida */}
                  <div className="ride-metrics-grid">
                    <div className="metric-item">
                      <span className="metric-label">Trajeto</span>
                      <span className="metric-value">
                        {ride.cidadeOrigem || 'Origem'} ➔ {ride.cidadeDestino || 'Destino'}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                        {ride.origem} ➔ {ride.destino}
                      </span>
                    </div>

                    <div className="metric-item">
                      <span className="metric-label">Passageiro & Motorista</span>
                      <span className="metric-value metric-highlight">{ride.passageiro || 'Passageiro Petrobras'}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                        Motorista: {ride.motorista} ({ride.placa})
                      </span>
                    </div>

                    <div className="metric-item">
                      <span className="metric-label">KM (Real vs Estimado)</span>
                      <span className="metric-value">
                        Real: <strong>{ride.kmReal} km</strong> | Est: {ride.kmEstimado} km
                      </span>
                      {parseFloat(ride.kmEstimado) > 0 && (
                        <span className="metric-diff-bad" style={{ fontSize: '0.78rem' }}>
                          Dif: +{(parseFloat(ride.kmReal) - parseFloat(ride.kmEstimado)).toFixed(1)} km ({((parseFloat(ride.kmReal) / parseFloat(ride.kmEstimado) - 1) * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>

                    <div className="metric-item">
                      <span className="metric-label">Valor da Corrida</span>
                      <span className="metric-value">
                        R$ {parseFloat(ride.valorTotal || 0).toFixed(2)}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                        Orçado: R$ {parseFloat(ride.valorEstimado || 0).toFixed(2)} {ride.custoEspera > 0 ? `| HP: R$ ${ride.custoEspera}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Nota Original do Motorista no TX20 (se existir) */}
                  {ride.rawJustification && (
                    <div style={{
                      padding: '8px 12px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderLeft: '3px solid var(--accent-cyan)',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: '12px',
                      fontSize: '0.84rem',
                      color: 'var(--text-secondary)'
                    }}>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>Registro no Sistema TX20 (Coluna CI):</span> "{ride.rawJustification}"
                    </div>
                  )}

                  {/* Editor de Justificativa da Empresa */}
                  <div className="justification-area">
                    <div className="justification-label-bar">
                      <span>Justificativa da Empresa (Será gravada na medição devolvida):</span>
                      <span style={{ 
                        color: quality.score === 'strong' ? '#34d399' : quality.score === 'medium' ? '#fbbf24' : '#f87171' 
                      }}>
                        {quality.feedback}
                      </span>
                    </div>

                    <textarea
                      className="justification-textarea"
                      value={ride.currentJustification || ''}
                      placeholder="Digite a justificativa detalhada ou clique em um dos atalhos rápidos abaixo..."
                      onChange={e => handleUpdateJustification(ride.id, e.target.value)}
                    />
                  </div>

                  {/* Botões Rápidos e Assistente de IA */}
                  <div className="presets-actions-row">
                    <div className="presets-group">
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginRight: '4px' }}>Atalhos:</span>
                      <button 
                        className="preset-btn"
                        onClick={() => handleApplyPreset(ride, 'transito')}
                        title="Desvio por trânsito intenso conforme GPS"
                      >
                        🚗 Trânsito / GPS
                      </button>

                      <button 
                        className="preset-btn"
                        onClick={() => handleApplyPreset(ride, 'passageiro')}
                        title="Solicitação expressa do passageiro"
                      >
                        👤 Pedido do Passageiro
                      </button>

                      <button 
                        className="preset-btn"
                        onClick={() => handleApplyPreset(ride, 'portaria')}
                        title="Desembarque em portaria ou posto de vigilância"
                      >
                        🏢 Portaria / PV
                      </button>

                      <button 
                        className="preset-btn"
                        onClick={() => handleApplyPreset(ride, 'cancelada')}
                        title="Corrida cancelada sem cobrança"
                      >
                        ❌ Cancelada (Não Faturada)
                      </button>

                      <button 
                        className="preset-btn"
                        onClick={() => handleApplyPreset(ride, 'pedagio')}
                        title="Pedágio conforme regras do contrato"
                      >
                        🛣️ Pedágio Contratual
                      </button>
                    </div>

                    <div className="actions-group">
                      <button 
                        className="btn btn-ai btn-sm"
                        disabled={aiGeneratingId === ride.id}
                        onClick={() => handleAiEnrich(ride)}
                        title="Usar IA Gemini para reescrever em padrão corporativo Petrobras"
                      >
                        {aiGeneratingId === ride.id ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            Gerando...
                          </>
                        ) : (
                          <>
                            <Sparkles size={14} />
                            Melhorar com IA (Gemini)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

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
              <label className="form-label">Chave de API do Google Gemini</label>
              <input 
                type="password" 
                className="form-control"
                value={geminiApiKey}
                onChange={e => handleSaveApiKey(e.target.value)}
                placeholder="Insira sua chave do Google AI Studio..."
              />
              <p className="form-hint">
                Chave utilizada para reescrever e enriquecer justificativas com o modelo <strong>gemini-3-flash-preview</strong>.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Contrato e Dados de Faturamento</label>
              <div style={{
                background: 'var(--bg-input)',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)'
              }}>
                <div><strong>Contrato SAP:</strong> 4600686169</div>
                <div><strong>Empresa:</strong> TAXI 2.0 / JESSICA BELLO DA SILVA</div>
                <div><strong>Ambiente de Deploy:</strong> Vercel (https://taxidoispontozero.com.br/medicao-petro/)</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>
                Salvar e Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
