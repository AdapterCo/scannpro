// Testes das regras do Firestore (ADMIN-APP-INSTRUCOES.md, seções 4, 12 e 13).
// Rodar com: npm run test:regras (sobe o emulador sozinho).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

const ID_A = '3F9A-12C0'; // dispositivo do cliente A
const ID_B = '7B21-0A4E'; // dispositivo do cliente B
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scannpro',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, id] of [['uidA', ID_A], ['uidB', ID_B]] as const) {
      await setDoc(doc(db, `clientes/${uid}`), { email: `${uid}@exemplo.com`, nome: uid, tokenMPFinal: '…8912' });
      await setDoc(doc(db, `segredos/${uid}`), { tokenMP: 'TEST-xxxxxxxxxxxx8912' });
      await setDoc(doc(db, `dispositivos/${id}`), {
        idmaq: id, dono: uid, nome: 'Totem', valor: 2000, ativo: true, online: false, ultimoSinal: null,
      });
      await setDoc(doc(db, `vendas/venda-${uid}`), { idmaq: id, dono: uid, valor: 2000, data: new Date(), idPagamento: `venda-${uid}` });
      await setDoc(doc(db, `pagamentos/pag-${uid}`), { idmaq: id, dono: uid, valor: 2000, status: 'pendente' });
    }
  });
});

const clienteA = () => env.authenticatedContext('uidA', { email: 'uidA@exemplo.com', firebase: { sign_in_provider: 'password' } }).firestore();
const anonimo = () => env.authenticatedContext('uidAnon', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const semLogin = () => env.unauthenticatedContext().firestore();
const dosMeus = (db: ReturnType<typeof clienteA>, col: string, uid = 'uidA') => query(collection(db, col), where('dono', '==', uid));
const novo = (id: string, extra: Record<string, unknown> = {}) => ({ idmaq: id, dono: 'uidA', nome: 'Novo', valor: 1500, ativo: true, criadoEm: serverTimestamp(), ...extra });

describe('equipamento (login anônimo)', () => {
  it('lê o próprio documento de dispositivo por get', () => assertSucceeds(getDoc(doc(anonimo(), `dispositivos/${ID_A}`))));
  it('não lista dispositivos', async () => {
    await assertFails(getDocs(collection(anonimo(), 'dispositivos')));
    await assertFails(getDocs(dosMeus(anonimo(), 'dispositivos')));
  });
  it('não lê segredos nem clientes', async () => {
    await assertFails(getDoc(doc(anonimo(), 'segredos/uidA')));
    await assertFails(getDoc(doc(anonimo(), 'clientes/uidA')));
  });
  it('não lê vendas', async () => {
    await assertFails(getDoc(doc(anonimo(), 'vendas/venda-uidA')));
    await assertFails(getDocs(dosMeus(anonimo(), 'vendas')));
  });
  it('não grava online nem ativo', async () => {
    await assertFails(updateDoc(doc(anonimo(), `dispositivos/${ID_A}`), { online: true }));
    await assertFails(updateDoc(doc(anonimo(), `dispositivos/${ID_A}`), { ativo: false }));
  });
  it('não cadastra dispositivo', () => assertFails(setDoc(doc(anonimo(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { dono: 'uidAnon' }))));
  it('lê pagamento por get, não lista nem aprova', async () => {
    await assertSucceeds(getDoc(doc(anonimo(), 'pagamentos/pag-uidA')));
    await assertFails(getDocs(collection(anonimo(), 'pagamentos')));
    await assertFails(updateDoc(doc(anonimo(), 'pagamentos/pag-uidA'), { status: 'aprovado' }));
  });
});

describe('sem login', () => {
  it('não lê nada', async () => {
    await assertFails(getDoc(doc(semLogin(), `dispositivos/${ID_A}`)));
    await assertFails(getDoc(doc(semLogin(), 'pagamentos/pag-uidA')));
  });
});

describe('cliente A vê e mexe só no que é dele', () => {
  it('lista os próprios dispositivos, vendas e pagamentos (com filtro de dono)', async () => {
    await assertSucceeds(getDocs(dosMeus(clienteA(), 'dispositivos')));
    await assertSucceeds(getDocs(dosMeus(clienteA(), 'vendas')));
    await assertSucceeds(getDocs(dosMeus(clienteA(), 'pagamentos')));
    await assertSucceeds(getDoc(doc(clienteA(), `dispositivos/${ID_A}`)));
  });
  it('consulta sem filtro de dono é recusada', async () => {
    await assertFails(getDocs(collection(clienteA(), 'dispositivos')));
    await assertFails(getDocs(collection(clienteA(), 'vendas')));
    await assertFails(getDocs(collection(clienteA(), 'pagamentos')));
  });
  it('não lê nem lista nada do cliente B', async () => {
    await assertFails(getDoc(doc(clienteA(), `dispositivos/${ID_B}`)));
    await assertFails(getDocs(dosMeus(clienteA(), 'dispositivos', 'uidB')));
    await assertFails(getDoc(doc(clienteA(), 'vendas/venda-uidB')));
    await assertFails(getDocs(dosMeus(clienteA(), 'vendas', 'uidB')));
    await assertFails(getDoc(doc(clienteA(), 'pagamentos/pag-uidB')));
    await assertFails(getDocs(dosMeus(clienteA(), 'pagamentos', 'uidB')));
    await assertFails(getDoc(doc(clienteA(), 'clientes/uidB')));
  });
  it('não altera nem exclui dispositivo do cliente B', async () => {
    await assertFails(updateDoc(doc(clienteA(), `dispositivos/${ID_B}`), { ativo: false }));
    await assertFails(deleteDoc(doc(clienteA(), `dispositivos/${ID_B}`)));
  });
  it('não toma para si um idmaq que já é de outro cliente', () => assertFails(setDoc(doc(clienteA(), `dispositivos/${ID_B}`), novo(ID_B))));
});

describe('cadastro de dispositivo', () => {
  it('cadastra ID livre com dono = ele mesmo', () => assertSucceeds(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001'))));
  it('recusa dono diferente do próprio uid', () => assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { dono: 'uidB' }))));
  it('recusa idmaq fora do formato', () => assertFails(setDoc(doc(clienteA(), 'dispositivos/aaaa-0001'), novo('aaaa-0001'))));
  it('recusa campo idmaq diferente do ID do documento', () => assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('BBBB-0002'))));
  it('recusa valor zero, decimal ou texto', async () => {
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { valor: 0 })));
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { valor: 20.5 })));
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { valor: '2000' })));
  });
  it('recusa ativo que não é booleano', () => assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { ativo: 'sim' }))));
  it('recusa criar já com online ou ultimoSinal', async () => {
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { online: false })));
    await assertFails(setDoc(doc(clienteA(), 'dispositivos/AAAA-0001'), novo('AAAA-0001', { ultimoSinal: null })));
  });
});

describe('edição do próprio dispositivo', () => {
  const meu = () => doc(clienteA(), `dispositivos/${ID_A}`);
  it('liga/desliga ativo e troca nome e valor', () => assertSucceeds(updateDoc(meu(), { ativo: false, nome: 'Outro', valor: 2500 })));
  it('não altera online, ultimoSinal, dono nem idmaq', async () => {
    await assertFails(updateDoc(meu(), { online: true }));
    await assertFails(updateDoc(meu(), { ultimoSinal: new Date() }));
    await assertFails(updateDoc(meu(), { dono: 'uidB' }));
    await assertFails(updateDoc(meu(), { idmaq: 'AAAA-0001' }));
  });
  it('não grava valor inválido', () => assertFails(updateDoc(meu(), { valor: -1 })));
  it('exclui o próprio dispositivo', () => assertSucceeds(deleteDoc(meu())));
});

describe('conta e token do cliente', () => {
  it('lê e grava o próprio clientes/{uid} só com email, nome e tokenMPFinal', async () => {
    await assertSucceeds(getDoc(doc(clienteA(), 'clientes/uidA')));
    await assertSucceeds(setDoc(doc(clienteA(), 'clientes/uidA'), { email: 'uidA@exemplo.com', nome: 'A', tokenMPFinal: '…abcd' }));
    await assertFails(setDoc(doc(clienteA(), 'clientes/uidA'), { email: 'x', tokenMP: 'TEST-vazado' }));
    await assertFails(setDoc(doc(clienteA(), 'clientes/uidB'), { email: 'x' }));
    await assertFails(getDocs(collection(clienteA(), 'clientes')));
  });
  it('escreve o próprio token mas não o lê de volta, não apaga e não escreve o de outro', async () => {
    await assertSucceeds(setDoc(doc(clienteA(), 'segredos/uidA'), { tokenMP: 'TEST-novo-0000' }));
    await assertFails(getDoc(doc(clienteA(), 'segredos/uidA')));
    await assertFails(deleteDoc(doc(clienteA(), 'segredos/uidA')));
    await assertFails(setDoc(doc(clienteA(), 'segredos/uidB'), { tokenMP: 'TEST-sequestro' }));
  });
  it('não grava vendas nem pagamentos (só o serviço de confiança)', async () => {
    await assertFails(setDoc(doc(clienteA(), 'vendas/999'), { idmaq: ID_A, dono: 'uidA', valor: 2000, data: new Date() }));
    await assertFails(updateDoc(doc(clienteA(), 'pagamentos/pag-uidA'), { status: 'aprovado' }));
  });
});
