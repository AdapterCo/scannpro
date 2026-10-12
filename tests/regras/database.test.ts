// Testes das regras de presença do Realtime Database (ADMIN-APP-INSTRUCOES.md, seções 4 e 13).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scannpro',
    database: { rules: readFileSync('database.rules.json', 'utf8') },
  });
});
afterAll(() => env.cleanup());

const anonimo = () => env.authenticatedContext('uid-anon', { firebase: { sign_in_provider: 'anonymous' } }).database();
const cliente = () => env.authenticatedContext('uidA', { firebase: { sign_in_provider: 'password' } }).database();
const semLogin = () => env.unauthenticatedContext().database();

describe('presenca/{idmaq}', () => {
  it('equipamento logado grava online e ts', () => assertSucceeds(set(ref(anonimo(), 'presenca/3F9A-12C0'), { online: true, ts: 1790000000000 })));
  it('recusa idmaq fora do formato, sem ts ou sem login', async () => {
    await assertFails(set(ref(anonimo(), 'presenca/3f9a-12c0'), { online: true, ts: 1 }));
    await assertFails(set(ref(anonimo(), 'presenca/3F9A-12C0'), { online: true }));
    await assertFails(set(ref(semLogin(), 'presenca/3F9A-12C0'), { online: true, ts: 1 }));
  });
  it('o painel (cliente com e-mail e senha) lê; anônimo e sem login não', async () => {
    await assertSucceeds(get(ref(cliente(), 'presenca/3F9A-12C0')));
    await assertFails(get(ref(anonimo(), 'presenca/3F9A-12C0')));
    await assertFails(get(ref(semLogin(), 'presenca/3F9A-12C0')));
  });
  it('fora de presenca nada é gravado', () => assertFails(set(ref(anonimo(), 'outro/x'), { a: 1 })));
});
