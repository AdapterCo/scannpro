// Testes das regras do Firestore (ADMIN-APP-INSTRUCOES.md, seções 4, 13 e 18).
// Rodar com: npm run test:regras (sobe o emulador sozinho).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';

const ID_A = '3F9A-12C0'; // dispositivo do cliente A, vinculado à centralA
const ID_B = '7B21-0A4E'; // dispositivo do cliente B
const COD = 'a'.repeat(32); // sessão ativa da centralA
const COD_EXP = 'b'.repeat(32); // sessão vencida
const COD_INATIVA = 'c'.repeat(32); // sessão com ativa=false
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-scannpro', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const futuro = Timestamp.fromMillis(Date.now() + 3600_000);
    for (const [uid, id] of [['uidA', ID_A], ['uidB', ID_B]] as const) {
      await setDoc(doc(db, `clientes/${uid}`), { email: `${uid}@exemplo.com`, nome: uid, tokenMPFinal: '…8912' });
      await setDoc(doc(db, `segredos/${uid}`), { tokenMP: 'TEST-xxxxxxxxxxxx8912' });
      await setDoc(doc(db, `dispositivos/${id}`), { idmaq: id, dono: uid, nome: 'Totem', valor: 2000, ativo: true });
      await setDoc(doc(db, `vendas/venda-${uid}`), { idmaq: id, dono: uid, valor: 2000, data: new Date(), idPagamento: `venda-${uid}` });
    }
    await setDoc(doc(db, `vinculos/${ID_A}`), { uid: 'centralA' });
    await setDoc(doc(db, 'equipamentos/centralA'), { idmaq: ID_A });
    const sessao = { idmaq: ID_A, uidTotem: 'centralA', sessaoId: 's1', escaneamentosRestantes: 2, impressoesRestantes: 2, ocupado: false };
    await setDoc(doc(db, `controles/${COD}`), { ...sessao, ativa: true, expiraEm: futuro });
    await setDoc(doc(db, `controles/${COD_EXP}`), { ...sessao, ativa: true, expiraEm: Timestamp.fromMillis(Date.now() - 1000) });
    await setDoc(doc(db, `controles/${COD_INATIVA}`), { ...sessao, ativa: false, expiraEm: futuro });
    await setDoc(doc(db, `controles/${COD}/comandos/existente`), { acao: 'escanear', confirmado: false, criadoEm: new Date() });
  });
});

const clienteA = () => env.authenticatedContext('uidA', { firebase: { sign_in_provider: 'password' } }).firestore();
const centralA = () => env.authenticatedContext('centralA', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const intruso = () => env.authenticatedContext('intruso', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const semLogin = () => env.unauthenticatedContext().firestore();
const dosMeus = (db: ReturnType<typeof clienteA>, col: string, uid = 'uidA') => query(collection(db, col), where('dono', '==', uid));
const venda = (id: string, extra: Record<string, unknown> = {}) => ({ idmaq: ID_A, dono: 'uidA', valor: 2000, data: serverTimestamp(), idPagamento: id, ...extra });

describe('anônimo qualquer (sem vínculo)', () => {
  it('lê dispositivo por get, não lista, não altera', async () => {
    await assertSucceeds(getDoc(doc(intruso(), `dispositivos/${ID_A}`)));
    await assertFails(getDocs(collection(intruso(), 'dispositivos')));
    await assertFails(updateDoc(doc(intruso(), `dispositivos/${ID_A}`), { ativo: false }));
  });
  it('não lê clientes nem vendas', async () => {
    await assertFails(getDoc(doc(intruso(), 'clientes/uidA')));
    await assertFails(getDoc(doc(intruso(), 'vendas/venda-uidA')));
    await assertFails(getDocs(dosMeus(intruso(), 'vendas')));
  });
  it('não lê segredos nem grava vendas', async () => {
    await assertFails(getDoc(doc(intruso(), 'segredos/uidA')));
    await assertFails(setDoc(doc(intruso(), 'vendas/999'), venda('999')));
  });
  it('não vincula um idmaq que já tem vínculo nem se passa pela central', async () => {
    await assertFails(setDoc(doc(intruso(), `vinculos/${ID_A}`), { uid: 'intruso' }));
    await assertFails(setDoc(doc(intruso(), 'equipamentos/intruso'), { idmaq: ID_A }));
  });
  it('vincula um idmaq livre só com o próprio uid', async () => {
    await assertSucceeds(setDoc(doc(intruso(), 'vinculos/AAAA-0001'), { uid: 'intruso' }));
    await assertFails(setDoc(doc(intruso(), 'vinculos/AAAA-0002'), { uid: 'outro' }));
    await assertFails(setDoc(doc(intruso(), 'vinculos/aaaa-0003'), { uid: 'intruso' }));
  });
});

describe('central vinculada', () => {
  it('lê o token do dono do dispositivo dela, e só esse', async () => {
    await assertSucceeds(getDoc(doc(centralA(), 'segredos/uidA')));
    await assertFails(getDoc(doc(centralA(), 'segredos/uidB')));
  });
  it('grava a venda com dono e valor do cadastro', () => assertSucceeds(setDoc(doc(centralA(), 'vendas/111'), venda('111'))));
  it('recusa venda com valor ou dono diferentes, de outro idmaq, ou com data do aparelho', async () => {
    await assertFails(setDoc(doc(centralA(), 'vendas/112'), venda('112', { valor: 1 })));
    await assertFails(setDoc(doc(centralA(), 'vendas/113'), venda('113', { dono: 'uidB' })));
    await assertFails(setDoc(doc(centralA(), 'vendas/114'), venda('114', { idmaq: ID_B, dono: 'uidB' })));
    await assertFails(setDoc(doc(centralA(), 'vendas/115'), venda('115', { data: new Date() })));
    await assertFails(setDoc(doc(centralA(), 'vendas/116'), venda('999')));
  });
  it('não altera nem apaga venda', async () => {
    await assertFails(updateDoc(doc(centralA(), 'vendas/venda-uidA'), { valor: 1 }));
    await assertFails(deleteDoc(doc(centralA(), 'vendas/venda-uidA')));
  });
  it('não altera o próprio vínculo', () => assertFails(updateDoc(doc(centralA(), `vinculos/${ID_A}`), { uid: 'outro' })));
});

describe('cliente A vê e mexe só no que é dele', () => {
  it('lista os próprios dispositivos e vendas (com filtro de dono)', async () => {
    await assertSucceeds(getDocs(dosMeus(clienteA(), 'dispositivos')));
    await assertSucceeds(getDocs(dosMeus(clienteA(), 'vendas')));
  });
  it('não lê nem lista nada do cliente B e não toma o idmaq dele', async () => {
    await assertFails(getDoc(doc(clienteA(), `dispositivos/${ID_B}`)));
    await assertFails(getDocs(dosMeus(clienteA(), 'vendas', 'uidB')));
    await assertFails(getDocs(collection(clienteA(), 'vendas')));
    await assertFails(setDoc(doc(clienteA(), `dispositivos/${ID_B}`), { idmaq: ID_B, dono: 'uidA', nome: 'x', valor: 100, ativo: true }));
  });
  it('não lê o próprio token de volta e não grava venda', async () => {
    await assertSucceeds(setDoc(doc(clienteA(), 'segredos/uidA'), { tokenMP: 'TEST-novo' }));
    await assertFails(getDoc(doc(clienteA(), 'segredos/uidA')));
    await assertFails(setDoc(doc(clienteA(), 'vendas/120'), venda('120')));
  });
  it('cadastra ID livre, edita valor/ativo, não troca dono', async () => {
    await assertSucceeds(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), { idmaq: 'AAAA-0001', dono: 'uidA', nome: 'Novo', valor: 1500, ativo: true }));
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0002'), { idmaq: 'AAAA-0002', dono: 'uidA', nome: 'x', valor: 0, ativo: true }));
    await assertSucceeds(updateDoc(doc(clienteA(), `dispositivos/${ID_A}`), { valor: 2500, ativo: false }));
    await assertFails(updateDoc(doc(clienteA(), `dispositivos/${ID_A}`), { dono: 'uidB' }));
  });
});

describe('controle pelo celular (seção 18)', () => {
  const comando = (acao: string, confirmado = false) => ({ acao, confirmado, criadoEm: serverTimestamp() });
  const comandos = (db: ReturnType<typeof clienteA>, cod = COD) => collection(db, `controles/${cod}/comandos`);

  it('quem tem o link lê a sessão sem login; ninguém lista', async () => {
    await assertSucceeds(getDoc(doc(semLogin(), `controles/${COD}`)));
    await assertSucceeds(getDoc(doc(semLogin(), `controles/${'f'.repeat(32)}`))); // inexistente: "sessão encerrada"
    await assertFails(getDocs(collection(semLogin(), 'controles')));
    await assertFails(getDocs(collection(clienteA(), 'controles')));
  });
  it('celular sem login cria pedidos válidos na sessão ativa', async () => {
    await assertSucceeds(addDoc(comandos(semLogin()), comando('escanear')));
    await assertSucceeds(addDoc(comandos(semLogin()), comando('imprimir')));
    await assertSucceeds(addDoc(comandos(semLogin()), comando('limpar', true)));
  });
  it('recusa limpar sem confirmação, ação inválida, campo a mais e hora do aparelho', async () => {
    await assertFails(addDoc(comandos(semLogin()), comando('limpar', false)));
    await assertFails(addDoc(comandos(semLogin()), comando('apagar_tudo')));
    await assertFails(addDoc(comandos(semLogin()), { ...comando('escanear'), extra: 1 }));
    await assertFails(addDoc(comandos(semLogin()), { acao: 'escanear', confirmado: false, criadoEm: new Date() }));
    await assertFails(addDoc(comandos(semLogin()), { acao: 'escanear', confirmado: 'sim', criadoEm: serverTimestamp() }));
  });
  it('recusa pedidos em sessão vencida, inativa ou inexistente', async () => {
    await assertFails(addDoc(comandos(semLogin(), COD_EXP), comando('escanear')));
    await assertFails(addDoc(comandos(semLogin(), COD_INATIVA), comando('escanear')));
    await assertFails(addDoc(comandos(semLogin(), 'd'.repeat(32)), comando('escanear')));
  });
  it('só o totem dono da sessão altera a sessão e lê/apaga os pedidos', async () => {
    await assertSucceeds(updateDoc(doc(centralA(), `controles/${COD}`), { ocupado: true }));
    await assertFails(updateDoc(doc(semLogin(), `controles/${COD}`), { escaneamentosRestantes: 99 }));
    await assertFails(updateDoc(doc(intruso(), `controles/${COD}`), { escaneamentosRestantes: 99 }));
    await assertFails(updateDoc(doc(clienteA(), `controles/${COD}`), { escaneamentosRestantes: 99 }));
    await assertSucceeds(getDocs(comandos(centralA())));
    await assertFails(getDocs(comandos(semLogin())));
    await assertFails(getDocs(comandos(intruso())));
    await assertFails(updateDoc(doc(centralA(), `controles/${COD}/comandos/existente`), { acao: 'imprimir' }));
    await assertSucceeds(deleteDoc(doc(centralA(), `controles/${COD}/comandos/existente`)));
    await assertSucceeds(deleteDoc(doc(centralA(), `controles/${COD}`)));
  });
  it('o totem cria a sessão só com o próprio uid', async () => {
    await assertSucceeds(setDoc(doc(centralA(), `controles/${'e'.repeat(32)}`), { uidTotem: 'centralA', ativa: true }));
    await assertFails(setDoc(doc(intruso(), `controles/${'9'.repeat(32)}`), { uidTotem: 'centralA', ativa: true }));
    await assertFails(setDoc(doc(semLogin(), `controles/${'8'.repeat(32)}`), { uidTotem: 'x', ativa: true }));
  });
});
