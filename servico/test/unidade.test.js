// Testes sem Firebase: assinatura do webhook, formato de data, limitador e o pedido HTTP ao Mercado Pago.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { assinaturaValida, criarClienteMP, dataMP } from '../src/mercadopago.js';
import { criarLimitador } from '../src/limite.js';
import { garantirIndices } from '../src/indices.js';
import { fileURLToPath } from 'node:url';

test('índices: cria os de firestore.indexes.json e aceita os que já existem', async () => {
  const chamadas = [];
  const respostas = [new Response('{}', { status: 200 }), new Response('{"error":{"status":"ALREADY_EXISTS"}}', { status: 409 })];
  const avisos = [];
  const r = await garantirIndices({
    credencial: { getAccessToken: async () => ({ access_token: 'tok' }) },
    projectId: 'proj',
    arquivo: fileURLToPath(new URL('../../firestore.indexes.json', import.meta.url)),
    log: { info() {}, warn: (m) => avisos.push(m) },
    fetch: async (url, op) => (chamadas.push([url, op]), respostas.shift() ?? new Response('{"error":"PERMISSION_DENIED"}', { status: 403 })),
  });
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0][0], 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/collectionGroups/vendas/indexes');
  assert.equal(chamadas[0][1].headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(chamadas[0][1].body), {
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'dono', order: 'ASCENDING' },
      { fieldPath: 'data', order: 'DESCENDING' },
    ],
  });
  assert.deepEqual(r.map(([, s]) => s), ['criando', 'ja-existe']);
  assert.equal(avisos.length, 0);
});

const segredo = 'segredo-de-teste';
const assinar = (manifesto) => createHmac('sha256', segredo).update(manifesto).digest('hex');

test('assinatura: aceita a calculada pelo manifesto da documentação', () => {
  const v1 = assinar('id:123456;request-id:req-1;ts:1704908010;');
  assert.equal(assinaturaValida({ xSignature: `ts=1704908010,v1=${v1}`, xRequestId: 'req-1', dataId: '123456', segredo }), true);
});

test('assinatura: recusa adulterada, segredo errado, id trocado ou cabeçalho ausente', () => {
  const v1 = assinar('id:123456;request-id:req-1;ts:1704908010;');
  const base = { xSignature: `ts=1704908010,v1=${v1}`, xRequestId: 'req-1', dataId: '123456', segredo };
  assert.equal(assinaturaValida({ ...base, dataId: '999' }), false);
  assert.equal(assinaturaValida({ ...base, segredo: 'outro' }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: `ts=1704908011,v1=${v1}` }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: undefined }), false);
  assert.equal(assinaturaValida({ ...base, xSignature: 'lixo' }), false);
});

test('assinatura: data.id alfanumérico vai em minúsculas e partes ausentes saem do manifesto', () => {
  const v1 = assinar('id:abc123;ts:1;');
  assert.equal(assinaturaValida({ xSignature: `ts=1,v1=${v1}`, dataId: 'ABC123', segredo }), true);
});

test('data no formato do Mercado Pago, no fuso de Brasília', () => {
  assert.equal(dataMP(Date.parse('2026-10-05T21:30:00Z')), '2026-10-05T18:30:00.000-03:00');
});

test('limitador: intervalo mínimo e máximo por janela, por chave', () => {
  let t = 0;
  const l = criarLimitador({ intervaloMinMs: 5000, maxPorJanela: 3, janelaMs: 60_000, agora: () => t });
  assert.equal(l.permitir('A'), true);
  assert.equal(l.permitir('A'), false); // menos de 5 s
  assert.equal(l.permitir('B'), true); // outra máquina não é afetada
  t = 6000;
  assert.equal(l.permitir('A'), true);
  t = 12000;
  assert.equal(l.permitir('A'), true);
  t = 18000;
  assert.equal(l.permitir('A'), false); // 3 na janela
  t = 61_000;
  assert.equal(l.permitir('A'), true); // a primeira saiu da janela
});

test('cliente MP: pedido do PIX com idempotência, valor em reais e sem vazar o token em erro', async () => {
  const recebidos = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      recebidos.push({ metodo: req.method, url: req.url, cab: req.headers, corpo: corpo ? JSON.parse(corpo) : null });
      if (req.url.endsWith('/erro')) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"invalid access token"}');
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"id":123,"point_of_interaction":{"transaction_data":{"qr_code":"000201"}}}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mp = criarClienteMP({ base });
  try {
    const r = await mp.criarPix({
      token: 'TEST-segredo',
      idInterno: 'id-1',
      valorCentavos: 1250,
      descricao: 'Sessão',
      emailPagador: 'p@x.com',
      expiraEm: Date.parse('2026-10-05T21:30:00Z'),
      notificationUrl: 'https://srv/webhook/mp?ref=id-1',
    });
    assert.equal(r.id, 123);
    const [p] = recebidos;
    assert.equal(p.metodo, 'POST');
    assert.equal(p.url, '/v1/payments');
    assert.equal(p.cab.authorization, 'Bearer TEST-segredo');
    assert.equal(p.cab['x-idempotency-key'], 'id-1');
    assert.deepEqual(p.corpo, {
      transaction_amount: 12.5,
      description: 'Sessão',
      payment_method_id: 'pix',
      external_reference: 'id-1',
      date_of_expiration: '2026-10-05T18:30:00.000-03:00',
      notification_url: 'https://srv/webhook/mp?ref=id-1',
      payer: { email: 'p@x.com' },
    });

    await mp.cancelar('TEST-segredo', '123');
    assert.equal(recebidos[1].metodo, 'PUT');
    assert.deepEqual(recebidos[1].corpo, { status: 'cancelled' });

    const erro = await mp.consultar('TEST-segredo', 'erro').catch((e) => e);
    assert.equal(erro.status, 401);
    assert.ok(!erro.message.includes('TEST-segredo'));
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});
