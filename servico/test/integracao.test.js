// Testes contra os emuladores do Firebase (Auth, Firestore, Realtime Database) com um Mercado Pago falso.
// Rodar da raiz do projeto: npm run test:servico (sobe os emuladores sozinho).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { criarServicoPagamentos } from '../src/pagamentos.js';
import { iniciarEspelhoPresenca } from '../src/presenca.js';
import { criarApp } from '../src/http.js';
import { criarLimitador } from '../src/limite.js';

const PROJETO = 'demo-scannpro';
const temEmulador = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
const opcoes = { skip: temEmulador ? false : 'emuladores não estão rodando (use npm run test:servico na raiz)' };

const ID = '3F9A-12C0';
const silencioso = { info() {}, warn() {}, error() {} };

function criarMPFalso() {
  const pagos = new Map();
  let seq = 90000;
  const chamadas = [];
  return {
    pagos,
    chamadas,
    async criarPix(a) {
      chamadas.push(['criar', a]);
      const id = ++seq;
      pagos.set(String(id), { id, status: 'pending', transaction_amount: a.valorCentavos / 100, currency_id: 'BRL', external_reference: a.idInterno, _token: a.token });
      return { id, status: 'pending', point_of_interaction: { transaction_data: { qr_code: `00020126PIXFALSO${id}` } } };
    },
    async consultar(token, id) {
      chamadas.push(['consultar', id]);
      const p = pagos.get(String(id));
      if (!p || p._token !== token) throw Object.assign(new Error('404'), { status: 404 });
      const { _token, ...resto } = p;
      return resto;
    },
    async cancelar(token, id) {
      chamadas.push(['cancelar', id]);
      const p = pagos.get(String(id));
      if (!p || p._token !== token || p.status !== 'pending') throw Object.assign(new Error('400'), { status: 400 });
      Object.assign(p, { status: 'cancelled', status_detail: 'by_collector' });
      return p;
    },
    aprovar(id, valorReais) {
      const p = pagos.get(String(id));
      p.status = 'approved';
      if (valorReais !== undefined) p.transaction_amount = valorReais;
    },
  };
}

let db, rtdb, auth, mp, pagamentos, base, servidor, tokenAnonimo, tokenSenha, relogio;

async function signUp(corpo) {
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corpo, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

async function limparFirestore() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: 'DELETE' });
}

async function cenario({ ativo = true, token = 'TEST-token-A', segredoWebhook } = {}) {
  await db.doc(`dispositivos/${ID}`).set({ idmaq: ID, dono: 'uidA', nome: 'Totem', valor: 2000, ativo, criadoEm: Timestamp.now() });
  await db.doc('segredos/uidA').set({ ...(token ? { tokenMP: token } : {}), ...(segredoWebhook ? { webhookSecret: segredoWebhook } : {}) });
}

const chamar = (caminho, { metodo = 'POST', token = tokenAnonimo, corpo, cab = {} } = {}) =>
  fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...cab },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

async function criarViaHTTP() {
  const r = await chamar('/pagamentos', { corpo: { idmaq: ID } });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
const mpIdDe = async (idInterno) => (await db.doc(`pagamentos/${idInterno}`).get()).get('mpId');
const webhook = (dataId, ref, cab = {}) => chamar(`/webhook/mp?data.id=${dataId}&type=payment${ref ? `&ref=${ref}` : ''}`, { token: null, corpo: { type: 'payment', data: { id: dataId } }, cab });

describe('serviço de confiança', opcoes, () => {
  before(async () => {
    initializeApp({ projectId: PROJETO, databaseURL: `https://${PROJETO}-default-rtdb.firebaseio.com` });
    db = getFirestore();
    rtdb = getDatabase();
    auth = getAuth();
    tokenAnonimo = await signUp({});
    tokenSenha = await signUp({ email: `cliente${Date.now()}@exemplo.com`, password: 'teste123' });
  });

  beforeEach(async () => {
    await limparFirestore();
    mp = criarMPFalso();
    relogio = { t: Date.now() };
    pagamentos = criarServicoPagamentos({
      db,
      mp,
      config: { validadeMin: 31, urlPublica: 'https://pagamentos.exemplo.com', emailPagador: 'p@x.com', descricao: 'Sessão' },
      log: silencioso,
      agora: () => relogio.t,
    });
    servidor?.close();
    servidor = criarApp({ auth, pagamentos, limitador: criarLimitador({ intervaloMinMs: 0 }), log: silencioso }).listen(0, '127.0.0.1');
    await new Promise((r) => servidor.once('listening', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    servidor?.close();
    rtdb?.goOffline();
    await db?.terminate();
    await Promise.all(getApps().map((a) => deleteApp(a)));
  });

  describe('POST /pagamentos (criarPagamento)', () => {
    test('exige ID token do login anônimo', async () => {
      await cenario();
      assert.equal((await chamar('/pagamentos', { token: null, corpo: { idmaq: ID } })).status, 401);
      assert.equal((await chamar('/pagamentos', { token: 'lixo', corpo: { idmaq: ID } })).status, 401);
      const r = await chamar('/pagamentos', { token: tokenSenha, corpo: { idmaq: ID } });
      assert.equal(r.status, 403);
      assert.deepEqual(await r.json(), { erro: 'Não autorizado.' });
    });

    test('cria o PIX com o valor do documento e grava pagamentos como pendente com idmaq e dono', async () => {
      await cenario();
      const r = await chamar('/pagamentos', { corpo: { idmaq: ID, valor: 1 } }); // valor do equipamento é ignorado
      assert.equal(r.status, 201);
      const j = await r.json();
      assert.deepEqual(Object.keys(j).sort(), ['expiraEm', 'idInterno', 'pixCopiaECola', 'valor']);
      assert.equal(j.valor, 2000);
      assert.match(j.pixCopiaECola, /^00020126/);
      assert.ok(j.expiraEm > Date.now() + 30 * 60_000);
      const p = (await db.doc(`pagamentos/${j.idInterno}`).get()).data();
      assert.equal(p.status, 'pendente');
      assert.equal(p.idmaq, ID);
      assert.equal(p.dono, 'uidA');
      assert.equal(p.valor, 2000);
      const [, args] = mp.chamadas.find(([c]) => c === 'criar');
      assert.equal(args.valorCentavos, 2000);
      assert.equal(args.token, 'TEST-token-A');
      assert.equal(args.idInterno, j.idInterno);
      assert.equal(args.notificationUrl, `https://pagamentos.exemplo.com/webhook/mp?ref=${j.idInterno}`);
    });

    test('recusa formato inválido, não cadastrado, desativado e cliente sem token', async () => {
      const erro = async (corpo) => {
        const r = await chamar('/pagamentos', { corpo });
        return [r.status, (await r.json()).erro];
      };
      assert.equal((await erro({ idmaq: '3f9a-12c0' }))[0], 400);
      assert.equal((await erro({}))[0], 400);
      assert.equal((await erro({ idmaq: ID }))[0], 404);
      await cenario({ ativo: false });
      assert.deepEqual(await erro({ idmaq: ID }), [409, 'Equipamento desativado.']);
      await cenario({ token: null });
      assert.equal((await erro({ idmaq: ID }))[0], 409);
      assert.equal(mp.chamadas.length, 0);
    });

    test('limita a frequência por idmaq', async () => {
      await cenario();
      servidor.close();
      servidor = criarApp({ auth, pagamentos, limitador: criarLimitador({ intervaloMinMs: 60_000 }), log: silencioso }).listen(0, '127.0.0.1');
      await new Promise((r) => servidor.once('listening', r));
      base = `http://127.0.0.1:${servidor.address().port}`;
      assert.equal((await chamar('/pagamentos', { corpo: { idmaq: ID } })).status, 201);
      assert.equal((await chamar('/pagamentos', { corpo: { idmaq: ID } })).status, 429);
    });
  });

  describe('webhookMP', () => {
    test('aprovado: consulta o MP, aprova com sessaoId e cria a venda com o dono certo', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId);
      assert.equal((await webhook(mpId, idInterno)).status, 200);
      const p = (await db.doc(`pagamentos/${idInterno}`).get()).data();
      assert.equal(p.status, 'aprovado');
      assert.match(p.sessaoId, /^[0-9a-f-]{36}$/);
      const v = (await db.doc(`vendas/${mpId}`).get()).data();
      assert.equal(v.idmaq, ID);
      assert.equal(v.dono, 'uidA');
      assert.equal(v.valor, 2000);
      assert.equal(v.idPagamento, mpId);
      assert.ok(v.data instanceof Timestamp);
    });

    test('aviso duplicado não duplica a venda nem troca o sessaoId', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId);
      await webhook(mpId, idInterno);
      const sessao1 = (await db.doc(`pagamentos/${idInterno}`).get()).get('sessaoId');
      await Promise.all([webhook(mpId, idInterno), webhook(mpId, idInterno), webhook(mpId)]);
      await pagamentos.conciliar();
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('sessaoId'), sessao1);
      assert.equal((await db.collection('vendas').get()).size, 1);
    });

    test('não confia no corpo: aviso de pagamento ainda pendente no MP não aprova', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      const r = await chamar(`/webhook/mp?data.id=${mpId}&type=payment&ref=${idInterno}`, {
        token: null,
        corpo: { type: 'payment', action: 'payment.updated', data: { id: mpId, status: 'approved' } },
      });
      assert.equal(r.status, 200);
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('status'), 'pendente');
      assert.equal((await db.collection('vendas').get()).size, 0);
    });

    test('pagamento de outro pedido (external_reference diferente) é ignorado', async () => {
      await cenario();
      const a = await criarViaHTTP();
      const b = await criarViaHTTP();
      const mpIdB = await mpIdDe(b.idInterno);
      mp.aprovar(mpIdB);
      await webhook(mpIdB, a.idInterno); // aviso de B apontando para A
      assert.equal((await db.doc(`pagamentos/${a.idInterno}`).get()).get('status'), 'pendente');
    });

    test('assinatura inválida é recusada com 401 quando o cliente configurou o segredo; válida é processada', async () => {
      const segredo = 'segredo-app-cliente-A';
      await cenario({ segredoWebhook: segredo });
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId);
      const ruim = await webhook(mpId, idInterno, { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'r1' });
      assert.equal(ruim.status, 401);
      assert.equal((await webhook(mpId, idInterno)).status, 401); // sem assinatura
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('status'), 'pendente');
      const v1 = createHmac('sha256', segredo).update(`id:${mpId};request-id:r2;ts:1704908010;`).digest('hex');
      const bom = await webhook(mpId, idInterno, { 'x-signature': `ts=1704908010,v1=${v1}`, 'x-request-id': 'r2' });
      assert.equal(bom.status, 200);
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('status'), 'aprovado');
    });

    test('valor diferente do do dispositivo não aprova nem cria venda', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId, 0.01);
      await webhook(mpId, idInterno);
      const p = (await db.doc(`pagamentos/${idInterno}`).get()).data();
      assert.equal(p.status, 'pendente');
      assert.match(p.alerta, /difere/);
      assert.equal((await db.collection('vendas').get()).size, 0);
    });

    test('dispositivo desligado (ativo=false) depois do PIX: o dinheiro entrou, a venda é registrada', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      await db.doc(`dispositivos/${ID}`).update({ ativo: false });
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId);
      await webhook(mpId, idInterno);
      assert.equal((await db.doc(`vendas/${mpId}`).get()).get('dono'), 'uidA');
    });

    test('aviso sem ref ou com id desconhecido responde 200 sem mexer em nada', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      mp.aprovar(mpId);
      assert.equal((await webhook('123', null)).status, 200);
      assert.equal((await webhook(mpId, null)).status, 200); // acha pelo mpId
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('status'), 'aprovado');
      const outro = await chamar('/webhook/mp?type=merchant_order&data.id=5', { token: null, corpo: {} });
      assert.equal(outro.status, 200);
    });
  });

  describe('cancelar e conciliar', () => {
    test('cancelar: pendente vira cancelado e é cancelado no MP; aprovado continua aprovado', async () => {
      await cenario();
      const a = await criarViaHTTP();
      assert.equal((await chamar(`/pagamentos/${a.idInterno}/cancelar`)).status, 200);
      assert.equal((await db.doc(`pagamentos/${a.idInterno}`).get()).get('status'), 'cancelado');
      assert.equal(mp.pagos.get(await mpIdDe(a.idInterno)).status, 'cancelled');

      const b = await criarViaHTTP();
      const mpIdB = await mpIdDe(b.idInterno);
      mp.aprovar(mpIdB); // pagou antes do cancelamento chegar
      await chamar(`/pagamentos/${b.idInterno}/cancelar`);
      assert.equal((await db.doc(`pagamentos/${b.idInterno}`).get()).get('status'), 'aprovado');
      assert.ok((await db.doc(`vendas/${mpIdB}`).get()).exists);

      assert.equal((await chamar('/pagamentos/nao-e-uuid/cancelar')).status, 400);
      assert.equal((await chamar(`/pagamentos/${a.idInterno}/cancelar`, { token: null })).status, 401);
    });

    test('conciliar aprova sem webhook (pagamentos de teste não geram aviso) e expira os vencidos', async () => {
      await cenario();
      const pago = await criarViaHTTP();
      const vencido = await criarViaHTTP();
      mp.aprovar(await mpIdDe(pago.idInterno));
      await db.doc(`pagamentos/${vencido.idInterno}`).update({ expiraEm: Timestamp.fromMillis(relogio.t - 1000) });
      const r = await pagamentos.conciliar();
      assert.equal(r[pago.idInterno], 'aprovado');
      assert.equal(r[vencido.idInterno], 'expirado');
      assert.equal((await db.doc(`pagamentos/${vencido.idInterno}`).get()).get('status'), 'expirado');
      assert.equal(mp.pagos.get(await mpIdDe(vencido.idInterno)).status, 'cancelled');
    });

    test('pago no último instante: expira localmente, mas o aviso posterior registra a venda', async () => {
      await cenario();
      const { idInterno } = await criarViaHTTP();
      const mpId = await mpIdDe(idInterno);
      await db.doc(`pagamentos/${idInterno}`).update({ status: 'expirado' });
      mp.aprovar(mpId);
      await webhook(mpId, idInterno);
      assert.ok((await db.doc(`vendas/${mpId}`).get()).exists);
      assert.equal((await db.doc(`pagamentos/${idInterno}`).get()).get('status'), 'expirado');
    });

    test('falha do Mercado Pago ao criar devolve 502 com mensagem e não deixa pendente', async () => {
      await cenario();
      mp.criarPix = async () => {
        throw new Error('timeout');
      };
      const r = await chamar('/pagamentos', { corpo: { idmaq: ID } });
      assert.equal(r.status, 502);
      assert.deepEqual(await r.json(), { erro: 'Não foi possível gerar o PIX. Tente de novo.' });
      const pend = await db.collection('pagamentos').where('status', '==', 'pendente').get();
      assert.equal(pend.size, 0);
    });
  });

  describe('espelho de presença', () => {
    const esperar = async (cond, ms = 5000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        if (await cond()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    test('online/offline vão para o dispositivo; idmaq não cadastrado é ignorado; cadastro tardio sincroniza', async () => {
      await rtdb.ref('presenca').remove();
      await cenario();
      const espelho = iniciarEspelhoPresenca({ rtdb, db, log: silencioso });
      try {
        await rtdb.ref(`presenca/${ID}`).set({ online: true, ts: 1790000000000 });
        assert.ok(await esperar(async () => (await db.doc(`dispositivos/${ID}`).get()).get('online') === true));
        assert.equal((await db.doc(`dispositivos/${ID}`).get()).get('ultimoSinal').toMillis(), 1790000000000);

        await rtdb.ref(`presenca/${ID}`).set({ online: false, ts: 1790000060000 });
        assert.ok(await esperar(async () => (await db.doc(`dispositivos/${ID}`).get()).get('online') === false));

        await rtdb.ref('presenca/FFFF-0000').set({ online: true, ts: 1 });
        await new Promise((r) => setTimeout(r, 800));
        await espelho.ocioso();
        assert.equal((await db.doc('dispositivos/FFFF-0000').get()).exists, false);

        // equipamento já online, cliente cadastra depois
        await db.doc('dispositivos/FFFF-0000').set({ idmaq: 'FFFF-0000', dono: 'uidA', nome: 'Novo', valor: 100, ativo: true });
        assert.ok(await esperar(async () => (await db.doc('dispositivos/FFFF-0000').get()).get('online') === true));
      } finally {
        espelho.parar();
        await espelho.ocioso();
      }
    });
  });
});
