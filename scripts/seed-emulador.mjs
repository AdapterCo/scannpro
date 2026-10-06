// Popula os EMULADORES locais (projeto demo-scannpro) com dados sintéticos da seção 17.
// Nunca toca o projeto real: só fala com 127.0.0.1.
//
//   npm run emuladores                (em outro terminal)
//   npm run seed:emulador             cria 2 clientes, dispositivos e vendas
//   node scripts/seed-emulador.mjs online 7B21-0A4E true    simula o espelhamento de presença
//
// Contas de teste (somente emulador), cada uma vê só os próprios dados:
//   cliente.a@exemplo.com / teste123   → 4 dispositivos, token configurado
//   cliente.b@exemplo.com / teste123   → 1 dispositivo, sem token (painel mostra o aviso)

const PROJETO = 'demo-scannpro';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const SENHA_TESTE = 'teste123';

function valor(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  return { stringValue: String(v) };
}

async function gravar(caminho, campos) {
  const fields = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, valor(v)]));
  const r = await fetch(`${FS}/${caminho}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, // ignora regras (só no emulador)
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`${caminho}: ${r.status} ${await r.text()}`);
}

async function criarUsuario(email) {
  const corpo = JSON.stringify({ email, password: SENHA_TESTE, returnSecureToken: true });
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: corpo,
  });
  const j = await r.json();
  if (r.ok) return j.localId;
  if (j.error?.message === 'EMAIL_EXISTS') {
    const l = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulador`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
    });
    return (await l.json()).localId;
  }
  throw new Error(`usuário ${email}: ${JSON.stringify(j)}`);
}

const minutos = (n) => new Date(Date.now() - n * 60_000);

async function popular() {
  const uidA = await criarUsuario('cliente.a@exemplo.com');
  const uidB = await criarUsuario('cliente.b@exemplo.com');
  await gravar(`clientes/${uidA}`, { email: 'cliente.a@exemplo.com', nome: 'Lava-rápido Centro', tokenMPFinal: '…8912' });
  await gravar(`clientes/${uidB}`, { email: 'cliente.b@exemplo.com', nome: 'Oficina do Bairro' });
  await gravar(`segredos/${uidA}`, { tokenMP: 'TEST-xxxxxxxxxxxxxxxx8912' });

  const dispositivos = [
    { idmaq: '3F9A-12C0', dono: uidA, nome: 'Totem entrada', valor: 2000, ativo: true, online: true, ultimoSinal: minutos(1) },
    { idmaq: '7B21-0A4E', dono: uidA, nome: 'Totem saída', valor: 2500, ativo: true, online: false, ultimoSinal: minutos(130) },
    { idmaq: '5E5E-9A9A', dono: uidA, nome: 'Box 3', valor: 1500, ativo: true, online: true, ultimoSinal: minutos(3) },
    { idmaq: 'C0DE-0001', dono: uidA, nome: 'Bancada de teste', valor: 100, ativo: false, online: false, ultimoSinal: null },
    { idmaq: 'B0B0-0002', dono: uidB, nome: 'Elevador 1', valor: 3000, ativo: true, online: true, ultimoSinal: minutos(2) },
  ];
  for (const d of dispositivos) await gravar(`dispositivos/${d.idmaq}`, { ...d, criadoEm: minutos(60 * 24 * 40) });

  // Vendas nos últimos 35 dias + duas na fronteira do dia (23:59:30 de ontem e 00:00 de hoje, horário de SP).
  const vendas = [];
  for (let dia = 0; dia < 35; dia++) {
    for (const d of dispositivos.filter((x) => x.idmaq !== 'C0DE-0001')) {
      const qtd = (dia * 7 + d.valor) % 4;
      for (let i = 0; i < qtd; i++) {
        vendas.push({ idmaq: d.idmaq, dono: d.dono, valor: d.valor, data: minutos(dia * 1440 + 30 + i * 47 + (d.valor % 90)) });
      }
    }
  }
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD
  const meiaNoite = new Date(`${hojeSP}T00:00:00-03:00`);
  vendas.push({ idmaq: '3F9A-12C0', dono: uidA, valor: 2000, data: new Date(meiaNoite.getTime() - 30_000) });
  vendas.push({ idmaq: '3F9A-12C0', dono: uidA, valor: 2000, data: meiaNoite });
  let n = 1000;
  for (const v of vendas) {
    const idPagamento = String(++n);
    await gravar(`vendas/${idPagamento}`, { ...v, idPagamento });
  }
  console.log(`Pronto: 2 clientes, ${dispositivos.length} dispositivos, ${vendas.length} vendas. Senha de teste: ${SENHA_TESTE}`);
}

async function mudarOnline(idmaq, online) {
  // Faz o papel do serviço de confiança (espelharPresenca): grava online e ultimoSinal.
  const r = await fetch(`${FS}/dispositivos/${idmaq}?updateMask.fieldPaths=online&updateMask.fieldPaths=ultimoSinal&currentDocument.exists=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { online: valor(online), ultimoSinal: valor(new Date()) } }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  console.log(`${idmaq} → ${online ? 'online' : 'offline'}`);
}

const [cmd, id, estado] = process.argv.slice(2);
try {
  if (cmd === 'online') await mudarOnline(id, estado === 'true');
  else await popular();
} catch (e) {
  console.error('Falhou. Os emuladores estão rodando (npm run emuladores)?\n', e.message);
  process.exit(1);
}
