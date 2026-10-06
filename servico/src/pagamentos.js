// Regras de pagamento (ADMIN-APP-INSTRUCOES.md, seções 6 e 16).
// Princípio: nada é aprovado pelo que o equipamento ou o corpo do webhook dizem;
// a aprovação só acontece depois de consultar o pagamento no Mercado Pago com o token do dono.
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { assinaturaValida } from './mercadopago.js';

export const IDMAQ_RE = /^[0-9A-F]{4}-[0-9A-F]{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Erro com mensagem curta em português que pode ser mostrada ao cliente no equipamento. */
export class ErroPublico extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function criarServicoPagamentos({ db, mp, config, log = console, agora = () => Date.now() }) {
  async function tokenDoDono(dono) {
    if (!dono) return null;
    const t = (await db.doc(`segredos/${dono}`).get()).get('tokenMP');
    return typeof t === 'string' && t ? t : null;
  }

  /** POST /pagamentos — cria o PIX com o valor do documento do dispositivo (nunca do equipamento). */
  async function criarPagamento(idmaq) {
    if (typeof idmaq !== 'string' || !IDMAQ_RE.test(idmaq)) throw new ErroPublico(400, 'ID do equipamento inválido.');
    const disp = await db.doc(`dispositivos/${idmaq}`).get();
    if (!disp.exists) throw new ErroPublico(404, 'Equipamento não cadastrado.');
    const d = disp.data();
    if (d.ativo !== true) throw new ErroPublico(409, 'Equipamento desativado.');
    if (!Number.isInteger(d.valor) || d.valor <= 0) throw new ErroPublico(409, 'Valor da sessão não configurado.');
    const token = await tokenDoDono(d.dono);
    if (!token) throw new ErroPublico(409, 'Pagamento indisponível: conta do Mercado Pago não configurada.');

    const idInterno = randomUUID();
    const expiraEm = agora() + config.validadeMin * 60_000;
    const ref = db.doc(`pagamentos/${idInterno}`);
    // Grava antes de chamar o Mercado Pago: um aviso que chegue rápido já encontra o documento.
    await ref.create({
      idmaq,
      dono: d.dono,
      valor: d.valor,
      status: 'pendente',
      criadoEm: FieldValue.serverTimestamp(),
      expiraEm: Timestamp.fromMillis(expiraEm),
      mpId: null,
    });

    let pg;
    try {
      pg = await mp.criarPix({
        token,
        idInterno,
        valorCentavos: d.valor,
        descricao: config.descricao,
        emailPagador: config.emailPagador,
        expiraEm,
        notificationUrl: config.urlPublica ? `${config.urlPublica}/webhook/mp?ref=${idInterno}` : undefined,
      });
    } catch (e) {
      log.error(`[pagamentos] falha ao criar PIX (${idmaq}): ${e.message}`);
    }
    const qr = pg?.point_of_interaction?.transaction_data?.qr_code;
    if (!pg?.id || typeof qr !== 'string' || !qr) {
      if (pg?.id) await mp.cancelar(token, String(pg.id)).catch(() => {});
      await ref.update({ status: 'cancelado', alerta: 'falha ao criar o PIX no Mercado Pago' });
      throw new ErroPublico(502, 'Não foi possível gerar o PIX. Tente de novo.');
    }
    await ref.update({ mpId: String(pg.id) });
    log.info?.(`[pagamentos] PIX criado ${idInterno} (${idmaq}, ${d.valor} centavos)`);
    return { idInterno, valor: d.valor, pixCopiaECola: qr, expiraEm };
  }

  /**
   * Consulta o pagamento no Mercado Pago e aplica o resultado. Idempotente: pode ser chamada
   * pelo webhook, pela conciliação e pelo cancelamento quantas vezes for preciso.
   */
  async function processarPagamento(idInterno, mpIdDoAviso, { statusSeCancelado } = {}) {
    const ref = db.doc(`pagamentos/${idInterno}`);
    const snap = await ref.get();
    if (!snap.exists) return 'desconhecido';
    const p = snap.data();
    if (p.status === 'aprovado') return 'ja-aprovado';
    const mpId = p.mpId ?? mpIdDoAviso;
    if (!mpId) return 'sem-mpId';
    const token = await tokenDoDono(p.dono);
    if (!token) return 'sem-token';

    const pg = await mp.consultar(token, mpId);
    if (String(pg?.external_reference ?? '') !== idInterno) {
      log.warn(`[pagamentos] ${mpId} não pertence a ${idInterno}; ignorado`);
      return 'referencia-diferente';
    }

    if (pg.status === 'approved') {
      const recebido = Math.round(Number(pg.transaction_amount) * 100);
      if (recebido !== p.valor || (pg.currency_id && pg.currency_id !== 'BRL')) {
        log.error(`[pagamentos] ${idInterno}: valor recebido ${recebido} difere do esperado ${p.valor}; não aprovado`);
        await ref.update({ mpId: String(mpId), alerta: `valor recebido ${recebido} difere do esperado ${p.valor}` });
        return 'valor-diferente';
      }
      const vendaRef = db.doc(`vendas/${mpId}`);
      return db.runTransaction(async (tx) => {
        const [atual, venda] = await tx.getAll(ref, vendaRef);
        const st = atual.get('status');
        // O dinheiro entrou: a venda é registrada mesmo que o pagamento já tenha expirado aqui
        // ou que o dispositivo tenha sido desligado depois, para o relatório bater com o extrato.
        if (!venda.exists) {
          tx.create(vendaRef, { idmaq: p.idmaq, dono: p.dono, valor: recebido, data: FieldValue.serverTimestamp(), idPagamento: String(mpId) });
        }
        if (st === 'pendente') {
          tx.update(ref, { status: 'aprovado', sessaoId: randomUUID(), mpId: String(mpId), aprovadoEm: FieldValue.serverTimestamp() });
          return 'aprovado';
        }
        if (st !== 'aprovado' && !venda.exists) {
          tx.update(ref, { alerta: `pago no Mercado Pago depois de ficar ${st}` });
          log.warn(`[pagamentos] ${idInterno} pago depois de ${st}: venda registrada sem abrir sessão`);
        }
        return venda.exists ? `ja-${st}` : `venda-registrada-${st}`;
      });
    }

    if (pg.status === 'cancelled' || pg.status === 'rejected') {
      const novo = statusSeCancelado ?? (pg.status_detail === 'expired' ? 'expirado' : 'cancelado');
      const mudou = await db.runTransaction(async (tx) => {
        const atual = await tx.get(ref);
        if (atual.get('status') !== 'pendente') return false;
        tx.update(ref, { status: novo, mpId: String(mpId) });
        return true;
      });
      return mudou ? novo : 'sem-mudanca';
    }
    return 'pendente';
  }

  /** Marca o pagamento local se ainda estiver pendente (transação: nunca sobrescreve um aprovado). */
  async function marcarSePendente(idInterno, status) {
    const ref = db.doc(`pagamentos/${idInterno}`);
    return db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (atual.get('status') !== 'pendente') return false;
      tx.update(ref, { status });
      return true;
    });
  }

  /** Cancela no Mercado Pago (melhor esforço) e depois confere: se já tiver sido pago, vale o pago. */
  async function encerrar(idInterno, p, statusFinal) {
    const token = await tokenDoDono(p.dono);
    if (token && p.mpId) {
      try {
        await mp.cancelar(token, p.mpId);
      } catch (e) {
        log.warn(`[pagamentos] cancelar ${idInterno} no Mercado Pago: ${e.message}`);
      }
      try {
        // Fomos nós que cancelamos no Mercado Pago: o status local é o pedido (cancelado ou expirado).
        const r = await processarPagamento(idInterno, undefined, { statusSeCancelado: statusFinal });
        if (r === 'aprovado' || r === statusFinal) return r;
      } catch (e) {
        log.warn(`[pagamentos] conferir ${idInterno}: ${e.message}`);
      }
    }
    return (await marcarSePendente(idInterno, statusFinal)) ? statusFinal : 'sem-mudanca';
  }

  /** POST /pagamentos/{idInterno}/cancelar — melhor esforço. */
  async function cancelarPagamento(idInterno) {
    if (typeof idInterno !== 'string' || !UUID_RE.test(idInterno)) throw new ErroPublico(400, 'Pagamento inválido.');
    const snap = await db.doc(`pagamentos/${idInterno}`).get();
    if (!snap.exists) throw new ErroPublico(404, 'Pagamento não encontrado.');
    const p = snap.data();
    if (p.status !== 'pendente') return p.status;
    return encerrar(idInterno, p, 'cancelado');
  }

  /** POST /webhook/mp — devolve o status HTTP a responder (200 confirma o recebimento). */
  async function receberWebhook({ query = {}, body = {}, headers = {} }) {
    const tipo = query.type ?? query.topic ?? body?.type;
    if (tipo && tipo !== 'payment') return { status: 200, resultado: 'ignorado' };
    const dataId = String(query['data.id'] ?? body?.data?.id ?? query.id ?? '');
    if (!/^\d+$/.test(dataId)) return { status: 200, resultado: 'sem-id' };

    let idInterno = typeof query.ref === 'string' && UUID_RE.test(query.ref) ? query.ref : null;
    let p;
    if (idInterno) {
      const snap = await db.doc(`pagamentos/${idInterno}`).get();
      p = snap.exists ? snap.data() : null;
    } else {
      const q = await db.collection('pagamentos').where('mpId', '==', dataId).limit(1).get();
      if (!q.empty) [idInterno, p] = [q.docs[0].id, q.docs[0].data()];
    }
    if (!p) return { status: 200, resultado: 'desconhecido' };
    if (p.mpId && p.mpId !== dataId) return { status: 200, resultado: 'id-diferente' };

    // Assinatura: o segredo é da aplicação do Mercado Pago do cliente (opcional, em segredos/{uid}.webhookSecret).
    const segredo = (await db.doc(`segredos/${p.dono}`).get()).get('webhookSecret');
    if (typeof segredo === 'string' && segredo) {
      const ok = assinaturaValida({ xSignature: headers['x-signature'], xRequestId: headers['x-request-id'], dataId, segredo });
      if (!ok) {
        log.warn(`[webhook] assinatura inválida para ${idInterno}`);
        return { status: 401, resultado: 'assinatura-invalida' };
      }
    }
    return { status: 200, resultado: await processarPagamento(idInterno, dataId) };
  }

  /**
   * Conciliação periódica: confere os pendentes no Mercado Pago (cobre aviso perdido e pagamentos
   * de teste, que não geram notificação) e expira os vencidos.
   */
  async function conciliar() {
    const snap = await db.collection('pagamentos').where('status', '==', 'pendente').limit(300).get();
    const resultados = {};
    for (const doc of snap.docs) {
      const p = doc.data();
      let r;
      try {
        if ((p.expiraEm?.toMillis?.() ?? 0) <= agora()) r = await encerrar(doc.id, p, 'expirado');
        else if (p.mpId) r = await processarPagamento(doc.id);
        else if (agora() - (p.criadoEm?.toMillis?.() ?? agora()) > 120_000) r = (await marcarSePendente(doc.id, 'cancelado')) ? 'cancelado' : 'sem-mudanca';
      } catch (e) {
        r = 'erro';
        log.warn(`[conciliacao] ${doc.id}: ${e.message}`);
      }
      if (r) resultados[doc.id] = r;
    }
    return resultados;
  }

  return { criarPagamento, cancelarPagamento, processarPagamento, receberWebhook, conciliar };
}
