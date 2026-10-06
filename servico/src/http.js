// Rotas HTTP (contrato da seção 16). Erros sempre como {"erro": "..."} em português, sem detalhes internos.
import express from 'express';
import { ErroPublico } from './pagamentos.js';
import { criarLimitador } from './limite.js';

export function criarApp({ auth, pagamentos, limitador = criarLimitador(), log = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // atrás do Caddy/nginx na própria VPS
  app.use(express.json({ limit: '16kb' }));

  /** Exige o ID token do login anônimo do Firebase (o equipamento). */
  async function equipamento(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
    if (!m) return res.status(401).json({ erro: 'Não autorizado.' });
    try {
      const decodificado = await auth.verifyIdToken(m[1]);
      if (decodificado.firebase?.sign_in_provider !== 'anonymous') return res.status(403).json({ erro: 'Não autorizado.' });
      req.uidEquipamento = decodificado.uid;
      next();
    } catch {
      res.status(401).json({ erro: 'Não autorizado.' });
    }
  }

  const responderErro = (res, e) => {
    if (e instanceof ErroPublico) return res.status(e.status).json({ erro: e.message });
    log.error(`[http] ${e.stack ?? e.message}`);
    res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
  };

  app.get('/saude', (_req, res) => res.json({ ok: true }));

  app.post('/pagamentos', equipamento, async (req, res) => {
    const idmaq = req.body?.idmaq;
    if (typeof idmaq === 'string' && !limitador.permitir(idmaq)) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns segundos.' });
    }
    try {
      res.status(201).json(await pagamentos.criarPagamento(idmaq));
    } catch (e) {
      responderErro(res, e);
    }
  });

  app.post('/pagamentos/:idInterno/cancelar', equipamento, async (req, res) => {
    try {
      await pagamentos.cancelarPagamento(req.params.idInterno);
      res.json({});
    } catch (e) {
      responderErro(res, e);
    }
  });

  // Chamado pelo Mercado Pago. 200 confirma o recebimento; erro inesperado → 500 para ele reenviar.
  app.post('/webhook/mp', async (req, res) => {
    try {
      const { status, resultado } = await pagamentos.receberWebhook({ query: req.query, body: req.body, headers: req.headers });
      log.info?.(`[webhook] ${req.query['data.id'] ?? req.body?.data?.id ?? '-'} → ${resultado}`);
      res.status(status).json({});
    } catch (e) {
      log.error(`[webhook] ${e.message}`);
      res.status(500).json({});
    }
  });

  app.use((_req, res) => res.status(404).json({ erro: 'Não encontrado.' }));
  // JSON malformado e outros erros do express
  app.use((e, _req, res, _next) => {
    if (e?.type === 'entity.parse.failed' || e?.status === 400) return res.status(400).json({ erro: 'Requisição inválida.' });
    responderErro(res, e);
  });
  return app;
}
