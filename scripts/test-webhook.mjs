import fs from 'node:fs';
import path from 'node:path';

/**
 * Lê variáveis de .env.local ou .env sem expor valores no console
 */
function loadEnvFile() {
  const candidates = ['.env.local', '.env'];
  const envMap = {};

  for (const file of candidates) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in envMap)) {
        envMap[key] = val;
      }
    }
  }
  return envMap;
}

const fileEnv = loadEnvFile();
const WEBHOOK_URL = process.env.WEBHOOK_URL || fileEnv.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || fileEnv.WEBHOOK_SECRET;

if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('✘ Erro: Defina WEBHOOK_URL e WEBHOOK_SECRET no arquivo .env.local antes de executar npm run test:webhook.');
  process.exit(1);
}

const status5Payload = {
  type: 'status',
  code: 'completed',
  status: 5,
  datetime: Math.floor(Date.now() / 1000),
  booking_id: '999999999',
  external_authorization_id: 'TEST-WEBHOOK-999999999',
  api_version: '3',
  amount: 85.4,
  stopped_time: 180,
  stopped_time_value: 4.5,
  toll_value: 0,
  parking_value: 0,
  discount_value: 0,
  driver_comment: 'Teste automatizado de webhook status 5 (ignorado na listagem de producao)',
  km: 18.45,
  time: 1420,
  category_id: '1'
};

const positionPayload = {
  type: 'position',
  latitude: '-22.906847',
  longitude: '-43.172896',
  speed: 42,
  angle: 180,
  datetime: Math.floor(Date.now() / 1000),
  booking_id: '999999999'
};

async function runTests() {
  console.log(`\nIniciando bateria de testes do Webhook em: ${WEBHOOK_URL}\n`);
  let failed = 0;

  // Caso (a): status 5 de teste (booking_id 999999999) com chave correta -> espera 200
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(status5Payload)
    });
    if (res.status === 200) {
      console.log('✔ (a) Status 5 de teste (booking_id 999999999) com chave correta -> HTTP 200');
    } else {
      console.log(`✘ (a) Status 5 de teste com chave correta -> Esperado 200, recebeu ${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`✘ (a) Erro de rede ao chamar webhook: ${err.message}`);
    failed++;
  }

  // Caso (b): mesmo corpo com chave errada -> espera 401
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': `${WEBHOOK_SECRET}_invalida`
      },
      body: JSON.stringify(status5Payload)
    });
    if (res.status === 401) {
      console.log('✔ (b) Mesmo corpo com chave errada -> HTTP 401');
    } else {
      console.log(`✘ (b) Mesmo corpo com chave errada -> Esperado 401, recebeu ${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`✘ (b) Erro de rede ao chamar webhook: ${err.message}`);
    failed++;
  }

  // Caso (c): sem header X-Webhook-Secret -> espera 401
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(status5Payload)
    });
    if (res.status === 401) {
      console.log('✔ (c) Requisição sem header X-Webhook-Secret -> HTTP 401');
    } else {
      console.log(`✘ (c) Sem header X-Webhook-Secret -> Esperado 401, recebeu ${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`✘ (c) Erro de rede ao chamar webhook: ${err.message}`);
    failed++;
  }

  // Caso (d): evento type=position -> espera 200 e nada gravado (ignored: true)
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(positionPayload)
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200 && body.ignored === true && body.reason === 'position_event') {
      console.log('✔ (d) Evento type=position -> HTTP 200 e descartado sem gravação no banco');
    } else {
      console.log(`✘ (d) Evento type=position -> Esperado 200 + ignored:true, recebeu status=${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`✘ (d) Erro de rede ao chamar webhook: ${err.message}`);
    failed++;
  }

  console.log('');
  if (failed > 0) {
    console.error(`✘ Resultado final: ${failed} teste(s) falharam.`);
    process.exit(1);
  } else {
    console.log('✔ Todos os 4 cenários do Webhook passaram com sucesso!');
  }
}

runTests();
