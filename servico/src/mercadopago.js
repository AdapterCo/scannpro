// Cliente mínimo da API de pagamentos do Mercado Pago (conferido na documentação oficial em 05/10/2026):
// - criar PIX: POST /v1/payments com payment_method_id "pix" e cabeçalho X-Idempotency-Key;
//   o "copia e cola" volta em point_of_interaction.transaction_data.qr_code;
//   date_of_expiration precisa estar entre 30 minutos e 30 dias.
// - consultar: GET /v1/payments/{id}
// - cancelar: PUT /v1/payments/{id} com {"status": "cancelled"} (só pending/in_process).
// - webhook: cabeçalho x-signature "ts=...,v1=..."; v1 = HMAC-SHA256 (hex) do manifesto
//   "id:[data.id];request-id:[x-request-id];ts:[ts];" com a assinatura secreta da aplicação.
// O token nunca entra em log nem em mensagem de erro.
import { createHmac, timingSafeEqual } from 'node:crypto';

export class ErroMP extends Error {
  constructor(status, mensagem) {
    super(`Mercado Pago respondeu ${status}: ${mensagem}`);
    this.status = status;
  }
}

/** Data no formato aceito pela API, no fuso de Brasília: 2026-10-05T18:30:00.000-03:00 */
export function dataMP(ms) {
  return new Date(ms - 3 * 3600_000).toISOString().replace('Z', '-03:00');
}

export function criarClienteMP({ base, fetch = globalThis.fetch }) {
  async function chamar(token, metodo, caminho, corpo, extras = {}) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extras },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* resposta não-JSON */
    }
    if (!r.ok) throw new ErroMP(r.status, String(json?.message ?? texto).slice(0, 200));
    return json;
  }

  return {
    /** Cria o PIX. idInterno vira external_reference e chave de idempotência. */
    criarPix({ token, idInterno, valorCentavos, descricao, emailPagador, expiraEm, notificationUrl }) {
      return chamar(
        token,
        'POST',
        '/v1/payments',
        {
          transaction_amount: valorCentavos / 100,
          description: descricao,
          payment_method_id: 'pix',
          external_reference: idInterno,
          date_of_expiration: dataMP(expiraEm),
          ...(notificationUrl ? { notification_url: notificationUrl } : {}),
          payer: { email: emailPagador },
        },
        { 'X-Idempotency-Key': idInterno },
      );
    },
    consultar(token, mpId) {
      return chamar(token, 'GET', `/v1/payments/${encodeURIComponent(mpId)}`);
    },
    cancelar(token, mpId) {
      return chamar(token, 'PUT', `/v1/payments/${encodeURIComponent(mpId)}`, { status: 'cancelled' });
    },
  };
}

/** Confere o cabeçalho x-signature de uma notificação de webhook. */
export function assinaturaValida({ xSignature, xRequestId, dataId, segredo }) {
  if (!xSignature || !segredo) return false;
  const partes = Object.fromEntries(
    String(xSignature)
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter((p) => p.length === 2),
  );
  if (!partes.ts || !partes.v1) return false;
  let manifesto = '';
  if (dataId) manifesto += `id:${String(dataId).toLowerCase()};`;
  if (xRequestId) manifesto += `request-id:${xRequestId};`;
  manifesto += `ts:${partes.ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(String(partes.v1), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
