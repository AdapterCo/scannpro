# ScannPro — serviço de confiança (VPS)

Serviço Node da seção 6 de `ADMIN-APP-INSTRUCOES.md`. Roda na VPS (135.181.154.162) com o Firebase Admin SDK. Faz quatro coisas:

| Peça | O que faz |
|---|---|
| `POST /pagamentos` (`criarPagamento`) | Chamada pelo equipamento com o ID token do **login anônimo**. Confere que o dispositivo existe e está `ativo`, lê o token do **dono** em `segredos/{dono}`, cria o PIX no Mercado Pago com o `valor` do documento (nunca um valor vindo do equipamento), grava `pagamentos/{uuid}` como `pendente` e devolve `{idInterno, valor, pixCopiaECola, expiraEm}`. Limita a frequência por `idmaq`. |
| `POST /pagamentos/{idInterno}/cancelar` | Melhor esforço: cancela no Mercado Pago e marca `cancelado` se ainda estiver `pendente`. Se já tiver sido pago, vale o pago. |
| `POST /webhook/mp` (`webhookMP`) | Chamada pelo Mercado Pago. **Consulta o pagamento no Mercado Pago com o token do dono** (não confia no corpo), confere `external_reference`, status `approved` e valor, e numa transação marca `aprovado` com `sessaoId` e cria `vendas/{idPagamento}` com `dono`. Avisos repetidos não duplicam. |
| Espelho de presença (`espelharPresenca`) | Escuta `presenca/{idmaq}` no Realtime Database e grava `online`/`ultimoSinal` em `dispositivos/{idmaq}`. `idmaq` não cadastrado é ignorado. Também sincroniza quando o cliente cadastra um dispositivo que já estava conectado. |

Também há uma **conciliação** a cada 20 s: confere no Mercado Pago os pagamentos `pendente` e marca `expirado` os vencidos (cancelando o PIX lá). Ela cobre avisos perdidos e é o que aprova pagamentos de **teste**, porque o Mercado Pago não envia notificação para pagamentos feitos com credenciais de teste.

## API do Mercado Pago usada (conferida na documentação oficial em 05/10/2026)

- Criar PIX: `POST https://api.mercadopago.com/v1/payments` com `payment_method_id: "pix"`, `transaction_amount` (reais), `payer.email`, `external_reference` (= `idInterno`), `notification_url` (`{URL_PUBLICA}/webhook/mp?ref={idInterno}`), `date_of_expiration` (entre 30 min e 30 dias) e cabeçalho `X-Idempotency-Key` (= `idInterno`). O "copia e cola" vem em `point_of_interaction.transaction_data.qr_code`.
- Consultar: `GET /v1/payments/{id}`. Cancelar: `PUT /v1/payments/{id}` com `{"status":"cancelled"}`.
- Assinatura do webhook: cabeçalho `x-signature: ts=...,v1=...`; `v1` = HMAC-SHA256 (hex) de `id:[data.id];request-id:[x-request-id];ts:[ts];` com a assinatura secreta da **aplicação** do Mercado Pago.

### Sobre a assinatura do webhook

A assinatura secreta é **por aplicação do Mercado Pago**, e cada cliente usa o próprio token (a própria aplicação). Por isso o serviço valida a assinatura quando o cliente tiver um segredo gravado em `segredos/{uid}.webhookSecret` (campo opcional; o painel ainda não tem tela para isso). **A segurança não depende dela**: nenhum pagamento é aprovado sem consultar o Mercado Pago com o token do dono e conferir `external_reference` e valor, então um aviso falso não aprova nada.

## Testes

Da raiz do projeto (sobe os emuladores do Firebase sozinho; exige Java 21):

```bash
npm run test:servico
```

São 6 testes unitários (assinatura, formato de data, limitador, pedido HTTP ao Mercado Pago) e 17 de integração nos emuladores, com um Mercado Pago falso. Os de integração cobrem: autenticação só por login anônimo, valor do documento, dispositivo inexistente, desativado ou sem token, limite de frequência, aprovação com `dono` certo, aviso duplicado, aviso com corpo mentiroso, `external_reference` de outro pedido, assinatura inválida, valor diferente, dispositivo desligado depois do PIX, cancelamento (inclusive depois de pago), conciliação, expiração, pagamento no último instante, falha do Mercado Pago e o espelho de presença.

## Instalação na VPS (Docker + Traefik)

O `docker-compose.yml` da raiz sobe o serviço e o painel em **https://scannpro.adapterco.com.br**, na rede `traefik9`:
- `/pagamentos`, `/webhook/mp` e `/saude` vão para este serviço (porta 8787);
- o resto vai para o painel.

1. Copie o projeto para a VPS e coloque a chave da conta de serviço do Firebase (console > Configurações do projeto > Contas de serviço > Gerar nova chave privada) em `servico/firebase-admin.json`. Ela é montada somente leitura no container e nunca entra na imagem. O container roda com o usuário `node` (uid 1000):
   ```bash
   sudo chown 1000:1000 servico/firebase-admin.json && sudo chmod 400 servico/firebase-admin.json
   ```
2. Suba:
   ```bash
   docker compose up -d --build
   ```
3. Confira: `curl https://scannpro.adapterco.com.br/saude` deve responder `{"ok":true}`. Logs: `docker compose logs -f servico` (o token do Mercado Pago nunca aparece neles).
4. No APK: `-PpaymentApiUrl=https://scannpro.adapterco.com.br`.

O DNS de `scannpro.adapterco.com.br` precisa apontar para a VPS; o certificado sai pelo `letsencrypt` do Traefik.

## Antes de declarar pronto (seção 13)

- Teste com credenciais de **teste** do Mercado Pago: a aprovação chega pela conciliação, porque pagamentos de teste não geram aviso.
- Faça uma **venda real de valor baixo**, confira no extrato do Mercado Pago do cliente e registre em `docs/ESTADO-DO-PROJETO.md`.
