// Ponto de entrada do serviço de confiança na VPS.
// Credencial: FIREBASE_CHAVE aponta para a chave da conta de serviço (arquivo fora do git).
// Variável própria de propósito: GOOGLE_APPLICATION_CREDENTIALS pode estar definida no sistema
// apontando para a chave de outro projeto.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { lerConfig } from './config.js';
import { criarClienteMP } from './mercadopago.js';
import { criarServicoPagamentos } from './pagamentos.js';
import { iniciarEspelhoPresenca } from './presenca.js';
import { criarApp } from './http.js';

const config = lerConfig();
if (!config.urlPublica.startsWith('https://')) {
  console.warn('[inicio] URL_PUBLICA não definida ou sem HTTPS: o Mercado Pago não conseguirá enviar avisos (a conciliação ainda funciona).');
}

const emulador = !!process.env.FIRESTORE_EMULATOR_HOST;
let credencial;
if (!emulador) {
  const chave = process.env.FIREBASE_CHAVE;
  if (!chave || !existsSync(chave) || !statSync(chave).isFile()) {
    console.error(
      `[inicio] Chave do Firebase Admin não encontrada (FIREBASE_CHAVE=${chave || '(vazio)'}).\n` +
        (chave && existsSync(chave)
          ? '  O caminho é uma PASTA, não um arquivo: o Docker cria uma pasta quando o arquivo não existe na hora do "up".\n' +
            '  Na VPS: docker compose down; rm -r servico/firebase-admin.json; copie o arquivo .json da chave; docker compose up -d\n'
          : '') +
        '  Gere em: console do Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada.',
    );
    process.exit(1);
  }
  const json = JSON.parse(readFileSync(chave, 'utf8'));
  if (json.project_id !== config.projectId) {
    console.error(`[inicio] A chave em ${chave} é do projeto "${json.project_id}", não de "${config.projectId}". Nada foi feito.`);
    process.exit(1);
  }
  credencial = cert(json);
}
initializeApp({
  ...(credencial ? { credential: credencial } : {}),
  projectId: config.projectId,
  databaseURL: config.databaseURL,
});
const db = getFirestore();
const rtdb = getDatabase();
const auth = getAuth();

const pagamentos = criarServicoPagamentos({ db, mp: criarClienteMP({ base: config.mpApi }), config });
const presenca = iniciarEspelhoPresenca({ rtdb, db });
const pastaPainel = process.env.PASTA_PAINEL && existsSync(process.env.PASTA_PAINEL) ? process.env.PASTA_PAINEL : null;
const servidor = criarApp({ auth, pagamentos, pastaPainel }).listen(config.porta, config.host, () =>
  console.log(`[inicio] serviço ScannPro ouvindo em ${config.host}:${config.porta}`),
);

// Conciliação sem sobreposição: só agenda a próxima quando a atual termina.
let parado = false;
let timer;
async function cicloConciliacao() {
  try {
    const r = await pagamentos.conciliar();
    const mudancas = Object.entries(r).filter(([, v]) => v !== 'pendente');
    if (mudancas.length) console.log(`[conciliacao] ${mudancas.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  } catch (e) {
    console.error(`[conciliacao] ${e.message}`);
  }
  if (!parado) timer = setTimeout(cicloConciliacao, config.conciliacaoS * 1000);
}
timer = setTimeout(cicloConciliacao, 3000);

async function desligar() {
  parado = true;
  clearTimeout(timer);
  presenca.parar();
  servidor.close();
  await presenca.ocioso();
  process.exit(0);
}
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
