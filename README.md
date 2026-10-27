# 🚖 Táxi 2.0 | Medição & Conciliação Petrobras
> Aplicação Web de apoio à medição e conciliação de glosas para o Contrato Petrobras SAP: **4600686169**.

---

## ⚡ Recursos Principais

1. **Cruzamento Automático com o Sistema TX20:**
   - Lê a planilha mestre operacional (`sistema tx20...xlsx`).
   - Associa instantaneamente por `No.Chamado` (QRU) e `eVoucher`.
   - Preenche automaticamente a coluna **`Justificativa da Empresa`** a partir da **Coluna CI** (`JUSTIFICATIVAS e Infos da QRU`).
   - Identifica registros de cancelamento na **Coluna AY** (`Obs.Moto`) e aplica a contestação padrão de cancelamento sem desconto.
   - Define o status de pagamento como **`LIBERADO PAGAMENTO`**.

2. **Motor de Análise de Qualidade de Justificativas:**
   - 🔴 **Fraca / Incompleta:** Detecta clichês genéricos (*"trajeto mais curto"*, *"pedido do cliente"*, textos < 25 chars) que os analistas rejeitam.
   - 🟡 **Média:** Apresenta motivo, mas carece de especificação de vias ou portarias.
   - 🟢 **Forte (Padrão Petrobras):** Contém vias específicas (BRs, anéis viários, rodovias, avenidas arteriais) ou portarias/postos de vigilância (PVs) + motivo plausível.

3. **Radar de Risco (⚠️ Requer Análise Manual no TX20):**
   - Alerta visual destacado sempre que houver:
     - Diferença de KM > 40% ou > 10 km a mais.
     - Corrida acima de 90 km.
     - Hora parada elevada (> 30 min ou > R$ 30).
     - Desembarque ou embarque em local divergente do chamado oficial.
     - Corrida de alto valor financeiro (> R$ 300).
     - Ausência de anotação do motorista.

4. **Inteligência Artificial (Google Gemini Integrado):**
   - Botão **"✨ Melhorar com IA (Gemini)"** em cada cartão.
   - Reescreve o relato do motorista em linguagem técnica, formal e contratual Petrobras com 1 clique.
   - Usa o modelo **`gemini-3-flash-preview`** (chave configurável).

5. **Atalhos Rápidos de 1 Clique (Presets):**
   - 🚗 **Trânsito / GPS:** Desvio por lentidão severa sugerido pelo GPS.
   - 👤 **Pedido do Passageiro:** Alteração de trajeto solicitada pelo usuário.
   - 🏢 **Portaria / PV:** Desembarque realizado em portaria ou posto de vigilância.
   - ❌ **Cancelada (Não Faturada):** Contestação padrão de cancelamento.
   - 🛣️ **Pedágio Contratual:** Justificativa de pedágio intermunicipal.

6. **Exportação Segura para Excel (.xlsx):**
   - Atualiza as abas `justificativas MOBICITY` e `justificativas Simcorpi`.
   - **Preserva 100% das fórmulas** originais (como `XLOOKUP`, `% KM`, `% Valor`, etc.) e layouts.

---

## 🚀 Como Executar Localmente

### Opção 1: Atalho de 1 Clique no Windows
Basta dar dois cliques no arquivo:
```
iniciar-app.bat
```
Ele abrirá automaticamente o navegador em `http://localhost:5173/`.

### Opção 2: Terminal
```bash
cd app-medicao-ui
npm install
npm run dev
```

---

## ☁️ Como Publicar no Vercel (Conectado ao seu GitHub)

1. Crie um novo repositório no seu GitHub (ex: `medicao-petro`).
2. No terminal, dentro da pasta `app-medicao-ui`, rode:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
3. Acesse [vercel.com](https://vercel.com) e clique em **"Add New Project"**.
4. Selecione o repositório que você acabou de subir.
5. Em **Framework Preset**, o Vercel detectará automaticamente **Vite**.
6. Clique em **Deploy**!
7. Nas configurações de domínio do Vercel (**Domains**), aponte para:
   - `medicao.taxidoispontozero.com.br` ou configure o proxy reverso para `taxidoispontozero.com.br/medicao-petro/`.
