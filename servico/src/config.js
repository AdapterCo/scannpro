// Configuração por variáveis de ambiente (veja .env.exemplo). Nada secreto fica aqui:
// a chave do Admin SDK vem de FIREBASE_CHAVE (arquivo só na VPS)
// e os tokens do Mercado Pago ficam em segredos/{uid} no Firestore.

export function lerConfig(env = process.env) {
  return {
    porta: Number(env.PORTA ?? 8787),
    /** 127.0.0.1 fora do Docker; no container, 0.0.0.0 para o Traefik alcançar. */
    host: env.HOST ?? '127.0.0.1',
    /** Endereço HTTPS público do serviço, sem barra no final (ex.: https://pagamentos.seudominio.com.br). */
    urlPublica: (env.URL_PUBLICA ?? '').replace(/\/+$/, ''),
    projectId: env.FIREBASE_PROJECT_ID ?? 'adapterdb-aba6f',
    databaseURL: env.FIREBASE_DATABASE_URL ?? 'https://adapterdb-aba6f-default-rtdb.firebaseio.com',
    mpApi: (env.MP_API_BASE ?? 'https://api.mercadopago.com').replace(/\/+$/, ''),
    /** Validade do PIX em minutos. O Mercado Pago exige entre 30 minutos e 30 dias. */
    validadeMin: Math.max(31, Number(env.PIX_VALIDADE_MIN ?? 31)),
    /** E-mail do pagador exigido pela API (o cliente final do totem não informa e-mail). */
    emailPagador: env.PIX_EMAIL_PAGADOR ?? 'pagador@scannpro.com.br',
    descricao: env.PIX_DESCRICAO ?? 'Sessão ScannPro',
    /** Intervalo da conciliação dos pagamentos pendentes, em segundos. */
    conciliacaoS: Math.max(5, Number(env.CONCILIACAO_S ?? 20)),
  };
}
