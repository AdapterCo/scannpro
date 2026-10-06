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
const semLogin = () => env.unauthenticatedContext().database();

describe('presenca/{idmaq}', () => {
  it('equipamento logado grava online e ts', () => assertSucceeds(set(ref(anonimo(), 'presenca/3F9A-12C0'), { online: true, ts: 1790000000000 })));
  it('recusa idmaq fora do formato', () => assertFails(set(ref(anonimo(), 'presenca/3f9a-12c0'), { online: true, ts: 1 })));
  it('recusa sem ts', () => assertFails(set(ref(anonimo(), 'presenca/3F9A-12C0'), { online: true })));
  it('recusa sem login', () => assertFails(set(ref(semLogin(), 'presenca/3F9A-12C0'), { online: true, ts: 1 })));
  it('ninguém lê pelo app', async () => {
    await assertFails(get(ref(anonimo(), 'presenca/3F9A-12C0')));
    await assertFails(get(ref(anonimo(), 'presenca')));
  });
  it('fora de presenca nada é gravado', () => assertFails(set(ref(anonimo(), 'outro/x'), { a: 1 })));
});
