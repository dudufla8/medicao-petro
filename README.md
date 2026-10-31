# 🚖 Táxi 2.0 | Medição & Conciliação Petrobras
> Aplicação Web e API Serverless de auditoria diária, medição e conciliação de glosas para o Contrato Petrobras SAP: **4600686169**.

---

## 🌐 Arquitetura de Produção (WordPress + Vercel + Neon Postgres)

- **URL Operacional (WordPress protegido por senha):** `https://taxidoispontozero.com.br/medicao-petro/`
- **Aplicação e API Serverless (Vercel):** `https://medicao-petro.vercel.app` (exibida via `<iframe>` dentro da página protegida do WordPress)
- **Endpoint do Webhook Táxi Digital:** `https://medicao-petro.vercel.app/api/taxidigital/webhook`
- **Sessão em Iframe Cross-Origin:** Autenticação com nome do operador + senha (`APP_ACCESS_PASSWORD`), protegida por rate-limit por IP no banco e token HMAC-SHA256 (`SESSION_SECRET`) trafegado via Cookie (`HttpOnly; Secure; SameSite=None; Partitioned`) **e** header `Authorization: Bearer` (garantindo funcionamento em qualquer navegador dentro do iframe do WordPress).
- **Segurança de Frame (`vercel.json`):** Header `Content-Security-Policy: frame-ancestors 'self' https://taxidoispontozero.com.br https://www.taxidoispontozero.com.br;` sem `X-Frame-Options` conflitante.

---

## ⚡ Recursos Principais

1. **Webhook Táxi Digital & Persistência (Neon Postgres):**
   - Recebe eventos de troca de status em `POST /api/taxidigital/webhook` validados em tempo constante via header `X-Webhook-Secret`.
   - Ignora e descarta eventos `type="position"` sem gravar coordenadas de localização (conformidade LGPD).
   - Registra eventos `type="status"` de forma idempotente (hash SHA-256) em `webhook_events` e consolida valores finais (`amount`, `stopped_time`, `stopped_time_value`, `toll_value`, `parking_value`, `discount_value`, `driver_comment`, `km`) em `ride_final_data` no status `completed` (`5`), sobrescrevendo apenas se `received_at` for mais recente.
   - Expurgo automático diário (`/api/cron/purge-webhooks`) apenas do payload bruto de `webhook_events` após `WEBHOOK_RETENTION_DAYS` (padrão 180 dias), preservando `ride_final_data`, `justifications` e `audit_log`.

2. **Cruzamento Automático com o Sistema TX20:**
   - Lê a planilha mestre operacional (`sistema tx20...xlsx`).
   - Associa por `No.Chamado` (QRU) e `eVoucher`.
   - Prioridade da anotação do motorista: **Justificativa aprovada > `driver_comment` (Webhook) > Planilha TX20 (Coluna CI)**.
   - Identifica registros de cancelamento na **Coluna AY** (`Obs.Moto`) e aplica a contestação padrão de cancelamento sem desconto.

3. **Motor de Análise de Qualidade de Justificativas:**
   - 🔴 **Fraca / Incompleta:** Detecta clichês genéricos (*"trajeto mais curto"*, *"pedido do cliente"*, textos < 25 chars) que os analistas rejeitam.
   - 🟡 **Média:** Apresenta motivo, mas carece de especificação de vias ou portarias.
   - 🟢 **Forte (Padrão Petrobras):** Contém vias específicas (BRs, anéis viários, rodovias, avenidas arteriais) ou portarias/postos de vigilância (PVs) + motivo plausível.

4. **Radar de Risco Configurável (⚠️ Requer Análise Manual):**
   - Diferença de KM > 40% ou > 10 km a mais.
   - Corrida acima de 90 km.
   - Hora parada elevada (> 30 min ou > R$ 30).
   - Desembarque ou embarque em local divergente do chamado oficial.
   - Corrida de alto valor financeiro (> R$ 300).
   - Ausência de anotação do motorista (não dispara falso positivo quando a corrida não possui evento de webhook e está marcada como *anotação indisponível via API*).

5. **Inteligência Artificial no Backend (`/api/gemini/improve`):**
   - Botão **"✨ Melhorar com IA (Gemini)"** em cada cartão.
   - A chave `GEMINI_API_KEY` fica exclusivamente no servidor (Vercel), nunca exposta no navegador.

6. **Exportação Segura para Excel (`.xlsx` com SheetJS `0.20.3`):**
   - Atualiza as abas `justificativas MOBICITY` e `justificativas Simcorpi`.
   - **Preserva 100% das fórmulas** originais (`XLOOKUP`, `% KM`, `% Valor`, etc.) e layouts.

---

## 🔐 Variáveis de Ambiente (`.env.example`)

Configure na Vercel (**Settings → Environment Variables**) — nunca versione valores reais:

| Variável | Descrição |
| :--- | :--- |
| `DATABASE_URL` | String de conexão do banco **Neon Postgres** exclusivo do projeto (Storage na Vercel). |
| `APP_ACCESS_PASSWORD` | Senha de acesso operacional ao app. |
| `SESSION_SECRET` | Segredo aleatório para assinatura HMAC-SHA256 dos tokens de sessão (separado de `APP_ACCESS_PASSWORD`). |
| `WEBHOOK_SECRET` | Segredo validado no header `X-Webhook-Secret` do endpoint `/api/taxidigital/webhook`. |
| `WEBHOOK_URL` | `https://medicao-petro.vercel.app/api/taxidigital/webhook` (usado pelo script local `npm run test:webhook`). |
| `CRON_SECRET` | Segredo usado pela Vercel para autenticar o Cron diário `/api/cron/purge-webhooks`. |
| `WEBHOOK_RETENTION_DAYS` | Dias de retenção do payload bruto de `webhook_events` (padrão `180`). |
| `GEMINI_API_KEY` | Chave da API Google Gemini (exclusiva do backend). |
| `GEMINI_MODEL` | Modelo Gemini no backend (padrão `gemini-2.5-flash`). |
| `TD_USER` | Usuário Basic Auth da API Táxi Digital. |
| `TD_PASS` | Senha Basic Auth da API Táxi Digital. |
| `TD_CLIENT_IDS` | Opcional — usar apenas se o diagnóstico do Checkpoint C comprovar necessidade de `X-uiCliente`. |

---

## 🚀 Como Executar e Testar

```bash
# Instalar dependências
npm install

# Rodar suíte de testes unitários (Vitest)
npm test

# Validar tipagem TypeScript
npx tsc --noEmit

# Gerar build de produção
npm run build

# Testar o webhook (contra produção na Vercel ou ambiente local)
npm run test:webhook
```
