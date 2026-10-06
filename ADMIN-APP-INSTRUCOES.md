# Instruções para criar o painel web dos clientes do ScannPro (Firebase + Mercado Pago)

Instrução de 05/10/2026, escrita para quem for construir (pessoa ou agente de IA). Revisada no mesmo dia: **não existe admin único**. Cada cliente tem o próprio login, cadastra e valida os próprios dispositivos e vê só os dispositivos e as vendas dele. Onde estiver "em aberto", pergunte ao dono antes de seguir. O fluxo do cliente final no equipamento está em `docs/SESSAO-E-PAGAMENTO.md`.

## 1. O que o dono pediu

- **Vários logins**, com e-mail e senha (Firebase Authentication). **As contas são criadas pelo dono**, no console do Firebase; não há cadastro aberto.
- Cada cliente **cadastra e valida os próprios dispositivos** pelo `idmaq`, o ID que o equipamento mostra na tela.
- Cada cliente **vê apenas os seus** dispositivos e as suas vendas. **Ninguém tem visão geral** de todos os clientes.
- **Token do Mercado Pago: um por cliente.** O cliente informa o token dele uma vez, e todos os dispositivos dele cobram nessa conta.
- **Ativo**: o cliente liga e desliga cada dispositivo dele.
- **Online/offline em tempo real** de cada dispositivo.
- **Painel** com quantos dispositivos o cliente tem **cadastrados, ativos, online e offline**.
- **Relatório de vendas de cada dispositivo.**
- Firebase para login e para guardar dispositivos e vendas.

Estrutura pedida:

| Coleção | Campos pedidos |
|---|---|
| dispositivo | `idmaq`, `nome`, `tokenMP`, `valor`, `ativo`, `online` |
| vendas | `idmaq`, `valor`, `data` |
| login | e-mail e senha |

## 2. Ajustes que o desenho exige

1. **Cada dispositivo, venda e pagamento leva o campo `dono`** (o `uid` do cliente). É isso que separa os dados de um cliente dos de outro.
2. **O `tokenMP` fica fora do documento do dispositivo e é do cliente, não do dispositivo.** O ID do dispositivo aparece na tela, em local público; se o token estivesse no documento, qualquer pessoa leria o ID, consultaria o Firebase e levaria o token. O token fica em `segredos/{uid do cliente}`, **só escrita pelo próprio cliente** (ninguém lê de volta) e lido apenas pelo serviço de confiança da seção 6. O documento `clientes/{uid}` guarda só `tokenMPFinal` (últimos 4 caracteres).
3. **Validação do dispositivo: só o ID da tela, o primeiro que cadastrar fica com ele.** Se o ID já pertence a outro cliente, o cadastro é recusado.
4. **`online` não é escrito pelo próprio equipamento.** É mantido pela **presença do Firebase** (seção 6), que percebe sozinha quando a conexão cai.
5. **`valor` em centavos, número inteiro** (2000 = R$ 20,00), no dispositivo e na venda.
6. **Campos acrescentados:** `ultimoSinal` (Timestamp) no dispositivo, para mostrar "offline desde…"; `idPagamento` na venda, usado como ID do documento para uma venda nunca ser gravada duas vezes. Há também a coleção operacional `pagamentos`, separada de `vendas`, para o equipamento saber se pagou sem ter acesso às vendas.

## 3. Dados

**Firestore**

| Documento | Campos | Quem lê | Quem escreve |
|---|---|---|---|
| `clientes/{uid}` | `email`, `nome`, `tokenMPFinal` | o próprio cliente | o próprio cliente |
| `segredos/{uid}` | `tokenMP` | ninguém pelo app (nem o cliente) | o próprio cliente (somente escrita); serviço de confiança lê com credencial de administrador |
| `dispositivos/{idmaq}` | `idmaq` (texto, igual ao ID do documento), `dono` (uid), `nome`, `valor` (centavos, inteiro), `ativo` (booleano), `online` (booleano), `ultimoSinal`, `criadoEm` | o dono; o equipamento só por `get` do próprio documento | o dono (`nome`, `valor`, `ativo`); serviço de confiança (`online`, `ultimoSinal`) |
| `vendas/{idPagamento}` | `idmaq`, `dono`, `valor` (centavos), `data` (Timestamp do servidor), `idPagamento` | o dono | só o serviço de confiança (webhook) |
| `pagamentos/{idInterno}` | `idmaq`, `dono`, `valor`, `status` (`pendente`, `aprovado`, `expirado`, `cancelado`), `criadoEm`, `sessaoId` (preenchido na aprovação) | equipamento por `get`; o dono | só o serviço de confiança |

**Realtime Database** (só para presença)

| Caminho | Campos | Quem escreve |
|---|---|---|
| `presenca/{idmaq}` | `online` (booleano), `ts` (hora do servidor) | o equipamento, e o próprio servidor do Firebase ao detectar a queda (`onDisconnect`) |

Regras do ID: `idmaq` no formato `XXXX-XXXX` (8 hexadecimais maiúsculos, o que o equipamento mostra). `idInterno` de `pagamentos` é aleatório (UUID), nunca o número do Mercado Pago, que é sequencial e adivinhável.

## 4. Regras de segurança

O equipamento entra com **login anônimo**; os clientes entram com **e-mail e senha**. As regras distinguem os dois pelo provedor de login.

**Firestore** (ponto de partida):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function logado()   { return request.auth != null; }
    function anonimo()  { return logado() && request.auth.token.firebase.sign_in_provider == 'anonymous'; }
    function cliente()  { return logado() && request.auth.token.firebase.sign_in_provider == 'password'; }
    function meu(dados) { return cliente() && dados.dono == request.auth.uid; }

    match /clientes/{uid} {
      allow get: if cliente() && request.auth.uid == uid;
      allow create, update: if cliente() && request.auth.uid == uid
                            && request.resource.data.keys().hasOnly(['email', 'nome', 'tokenMPFinal']);
      allow list, delete: if false;
    }
    match /segredos/{uid} {
      allow create, update: if cliente() && request.auth.uid == uid;   // somente escrita
      allow read, delete: if false;
    }
    match /dispositivos/{idmaq} {
      allow get: if anonimo() || meu(resource.data);                   // equipamento lê o próprio documento
      allow list: if meu(resource.data);                               // consulta precisa filtrar dono == uid
      // Criar só se o ID ainda não existe: se já for de outro cliente, a gravação vira "update" e é recusada.
      allow create: if cliente()
                    && request.resource.data.dono == request.auth.uid
                    && request.resource.data.idmaq == idmaq
                    && idmaq.matches('^[0-9A-F]{4}-[0-9A-F]{4}$')
                    && request.resource.data.valor is int && request.resource.data.valor > 0
                    && request.resource.data.ativo is bool
                    && !request.resource.data.keys().hasAny(['online', 'ultimoSinal']);
      allow update: if meu(resource.data)
                    && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['dono', 'idmaq', 'online', 'ultimoSinal'])
                    && request.resource.data.valor is int && request.resource.data.valor > 0
                    && request.resource.data.ativo is bool;
      allow delete: if meu(resource.data);
    }
    match /vendas/{id}     { allow read: if meu(resource.data); allow write: if false; }
    match /pagamentos/{id} {
      allow get: if anonimo() || meu(resource.data);
      allow list: if meu(resource.data);
      allow write: if false;
    }
  }
}
```

O serviço de confiança usa credencial de administrador do Firebase e por isso grava `online`, `ultimoSinal`, `vendas` e `pagamentos` sem passar por estas regras. Toda consulta de lista do painel (`dispositivos`, `vendas`, `pagamentos`) precisa ter `where('dono', '==', uid)`, senão o Firestore recusa.

**Realtime Database** (presença):

```
{
  "rules": {
    "presenca": {
      "$idmaq": {
        ".read": false,
        ".write": "auth != null && $idmaq.matches(/^[0-9A-F]{4}-[0-9A-F]{4}$/)",
        ".validate": "newData.hasChildren(['online', 'ts'])"
      }
    }
  }
}
```

Teste tudo no emulador do Firebase antes de publicar: um usuário anônimo **não** lê `segredos`, `clientes` nem `vendas`, e não lista `dispositivos`. Um cliente **não** lê nem lista dispositivos, vendas ou pagamentos de outro cliente, não toma para si um `idmaq` que já é de outro e não altera `online`. Desative o cadastro público em Authentication: só o dono cria contas.

## 5. Telas e critérios de aceite

1. **Login.** E-mail e senha, "esqueci a senha" (e-mail de redefinição do Firebase), sair. Não há tela de criar conta. *Aceite:* um cliente nunca vê dados de outro.
2. **Painel (tela inicial).** Quatro cartões dos dispositivos **do cliente logado**, atualizados sozinhos em tempo real: **Cadastrados**, **Ativos**, **Online**, **Offline**. Abaixo, a lista "Ativos fora do ar", com "offline desde" a partir de `ultimoSinal`. Tocar num cartão abre a lista filtrada. Definições: Cadastrados = dispositivos com `dono == uid`; Ativos = `ativo == true`; Online = `online == true`; Offline = Cadastrados − Online. *Aceite:* ao desligar a energia de um dispositivo online, em até cerca de 1 a 2 minutos ele passa de Online para Offline sem o cliente tocar em nada; ao religar, volta.
3. **Dispositivos.** Lista com nome, `idmaq`, valor, interruptor **Ativo**, bolinha de estado (verde online, vermelha offline) e vendas de hoje. *Aceite:* mudar o interruptor grava `ativo` e o equipamento reage em segundos.
4. **Cadastrar (validar) e editar dispositivo.** Campos: `idmaq` (validação de formato), `nome`, `valor` (digitado em reais, gravado em centavos, inteiro maior que zero), `ativo`. *Aceite:* `idmaq` fora do formato é recusado; `idmaq` que já pertence a outro cliente é recusado com "Este dispositivo já está cadastrado"; o equipamento sai de "Aguardando ativação" quando o cadastro é salvo com `ativo` ligado.
5. **Conta e token do Mercado Pago.** O cliente informa o `tokenMP` (campo de senha) uma vez; salvar grava `segredos/{uid}` e `tokenMPFinal` em `clientes/{uid}` juntos (lote). O token nunca é exibido depois de salvo; para trocar, digitar outro. *Aceite:* sem token configurado, o painel avisa que os dispositivos não conseguem cobrar.
6. **Relatório de vendas por dispositivo.** Escolher o dispositivo e o período (hoje, 7 dias, 30 dias, mês, intervalo livre). Mostra total vendido, quantidade, ticket médio e lista (data, valor). Visão "todos os meus dispositivos": uma linha por dispositivo com total e quantidade, e o total geral. Exportar CSV. *Aceite:* os totais batem com a soma da lista; o dia vai de 00:00 a 23:59 em `America/Sao_Paulo`.

Interface em português do Brasil, valores em R$, estados vazio/carregando/erro de rede em todas as telas. As consultas por `dono` combinadas com `idmaq` e intervalo de `data` exigem índices compostos; o Firestore mostra o link para criá-los na primeira execução.

## 6. Serviço de confiança (indispensável)

Quem fala com o Mercado Pago precisa guardar o token, por isso **não pode ser o equipamento nem o painel**. Peças:

- **`criarPagamento(idmaq)`**, chamada pelo equipamento. Confere que o dispositivo existe e está `ativo`, lê o `dono` dele, lê o token em `segredos/{dono}`, pede ao Mercado Pago um PIX com o `valor` do dispositivo, grava `pagamentos/{idInterno}` como `pendente` (com `idmaq` e `dono`) e devolve ao equipamento o `idInterno`, o texto "copia e cola" do PIX e a validade.
- **`webhookMP`**, chamada pelo Mercado Pago. Valida a assinatura da notificação, **consulta o pagamento no Mercado Pago pelo identificador** usando o token do dono daquele pagamento (não confia no corpo recebido), confere que está aprovado e que o valor é o do dispositivo, e então, numa transação, marca `pagamentos` como `aprovado` com um `sessaoId` e cria `vendas/{idPagamento}` com `idmaq`, `dono`, `valor` e `data`. Se o mesmo aviso chegar de novo, não duplica.
- **`espelharPresenca`**, disparada por qualquer mudança em `presenca/{idmaq}` no Realtime Database. Se existir `dispositivos/{idmaq}`, grava nele `online` e `ultimoSinal`. Se o `idmaq` não estiver cadastrado, ignora (não cria documento).
- Opcional: **`testarToken`**, para o cliente conferir, ao salvar, que o token é válido e de qual conta é (sem devolver o token).

Os nomes e campos exatos da API do Mercado Pago (criação do pagamento PIX, notificação, assinatura) devem ser conferidos na documentação oficial na hora de implementar; não foram consultados ao escrever este documento.

**Decisão do dono (05/10/2026): o serviço roda na VPS dele (135.181.154.162), em Node, com o Firebase Admin SDK.** Sem Cloud Functions e sem plano Blaze. Consequências para quem implementar:
- precisa de endereço **HTTPS** público para o webhook do Mercado Pago e para o equipamento chamar `criarPagamento`;
- `criarPagamento` não pode ser aberta a qualquer um: exige o **ID token do login anônimo** do Firebase no cabeçalho e confere, com o Admin SDK, que ele é válido e que o `idmaq` pedido existe e está `ativo`; limitar a frequência por `idmaq`;
- a chave da conta de serviço do Admin SDK fica **só na VPS**, fora de qualquer repositório e nunca em chat;
- o serviço também escuta `presenca/{idmaq}` no Realtime Database e espelha `online`/`ultimoSinal` no Firestore (substitui a função `espelharPresenca`).

**Por que presença no Realtime Database e não um "sinal de vida" no Firestore.** O Firestore não percebe quando um cliente some. A alternativa seria o equipamento gravar um carimbo de hora a cada poucos minutos e o painel considerar offline quem passou do limite: funciona, mas o offline só aparece depois de 2 a 3 intervalos e obriga o equipamento a manter um laço periódico de escrita. O Realtime Database tem `onDisconnect`: o servidor do Firebase grava "offline" quando a conexão cai, sem laço no equipamento. Usar o padrão oficial de presença do Firebase (`.info/connected` + `onDisconnect`), que também trata a reconexão.

## 7. Como o equipamento usa o Firebase

- Entra com **login anônimo** (não tem e-mail e senha).
- **Presença:** ao ficar conectado, grava `presenca/{idmaq}.online = true` e registra `onDisconnect` para gravar `false`. Nenhum laço de envio. **Decisão do dono: "online" = equipamento com internet E módulo USB (leitor) conectado.** O app só mantém `presenca/{idmaq}.online = true` enquanto as duas condições valem; ao soltar o USB grava `false` (sem laço: reage ao evento de USB conectado/removido que o app já recebe). A impressora não entra na conta. Quando a internet cai, quem marca offline é o `onDisconnect`, em segundos.
- **Ativação sem código:** a tela mostra o `idmaq` e "Aguardando ativação". Quando o cliente cadastra o dispositivo e liga `ativo`, o equipamento, que ouve o próprio documento (escuta em tempo real, sem varredura), recebe `nome` e `valor` e vai para a tela de pagamento. Desligar `ativo` volta o equipamento a "não ativado".
- **Pagamento:** chama `criarPagamento`, mostra o QR e escuta `pagamentos/{idInterno}`. Quando `status` vira `aprovado`, abre a sessão com o `sessaoId` (regras de 2 escaneamentos, 2 impressões e 5 minutos já implementadas no app). `expirado` ou `cancelado` voltam à tela de pagamento.
- O equipamento não sabe quem é o dono: ele só lê o próprio documento e chama o serviço. A troca para vários clientes não muda o app do equipamento.
- Os contadores da sessão continuam sendo aplicados só pelo equipamento nesta versão; o modelo de dados pedido não guarda sessões.

## 8. Projeto Firebase deste sistema

Projeto já criado pelo dono: **`adapterdb-aba6f`**. Usar o mesmo projeto no app do equipamento e no painel.

```
apiKey:            AIzaSyBYeBJCc-P7RXjNT_AjJcZpbchU1tWS8RQ
authDomain:        adapterdb-aba6f.firebaseapp.com
projectId:         adapterdb-aba6f
storageBucket:     adapterdb-aba6f.appspot.com
messagingSenderId: 1007908134102
appId (web):       1:1007908134102:web:8a6d7d06beb781f3067d77
databaseURL:       https://adapterdb-aba6f-default-rtdb.firebaseio.com  (região us-central1)
```

A `apiKey` do Firebase identifica o projeto e **não é segredo**; quem protege os dados são as regras do Firestore e do Realtime Database (seção 4). Por isso as regras nunca podem ficar abertas.

O `appId` acima é de um app **web**, o que serve ao painel web. O app do equipamento inicializa o SDK à mão com estes valores.

**Estado verificado em 05/10/2026 (consultas de leitura, sem login):** o Firestore existe e recusa leitura sem login (as regras atuais não estão abertas). O Realtime Database foi ativado pelo dono no mesmo dia (us-central1) e, ao ser consultado sem login, **respondeu 200 (leitura pública aberta, regras em modo de teste)**: as regras da seção 4 precisam ser publicadas antes de qualquer uso. Provedores de login e regras publicadas não foram verificados (exigem o console).

## 9. Configuração do Firebase (passo a passo para o dono)

1. Ativar **Authentication > E-mail/senha** e **Login anônimo**; desativar o cadastro público de usuários. 2. Para cada cliente, criar a conta (e-mail e senha) em Authentication. 3. Ativar o **Firestore** em modo produção e publicar as regras da seção 4. 4. Ativar o **Realtime Database** e publicar as regras de presença. 5. Para o serviço de confiança: a VPS (decisão da seção 6).

## 10. O que não fazer

- Não colocar o `tokenMP` em `dispositivos`, em `clientes`, em `BuildConfig`, no APK, no Firestore legível por alguém, nem em log.
- Não deixar regras abertas (`allow read, write: if true`) nem modo de teste do Firestore ou do Realtime Database.
- Não aprovar pagamento com base no que o equipamento ou o corpo do webhook diz.
- Não deixar o equipamento gravar `online` direto em `dispositivos`.
- Não exibir o token de volta no painel.
- Não fazer consulta de lista sem filtrar por `dono`.
- O caminho que o Mercado Pago recomenda para cobrar em nome de várias contas é OAuth (cada cliente autoriza). O dono decidiu que cada cliente informa o próprio token; OAuth fica como melhoria futura.

## 11. Limitações conhecidas

- **Validação só pelo ID da tela (decisão do dono):** quem enxergar o ID na tela de um equipamento pode cadastrá-lo antes do cliente certo. Nesse caso o dono corrige pelo console (apaga o documento em `dispositivos`), porque não há visão geral no painel.
- **A presença é informativa e pode ser forjada** por quem souber o `idmaq`: alguém poderia fazer um dispositivo parecer online. O dinheiro não depende disso, porque a venda só nasce do aviso do Mercado Pago validado.
- **Tempo para aparecer offline:** com queda de energia sem desligar a rede de forma limpa, o servidor demora para perceber (da ordem de um minuto; medir na prática). Desligar o Wi-Fi de forma limpa é percebido mais rápido.
- **Trocar de aparelho ou apagar os dados do app gera um `idmaq` novo**: é preciso cadastrar o dispositivo de novo.
- **Equipamento sem Google Play Services:** multimídias de ROM genérica podem não ter. O login anônimo, o Firestore e o Realtime Database costumam funcionar sem eles, mas confirmar na MP5-AR1001; App Check/Play Integrity, que protegeria `criarPagamento` contra abuso, não funcionaria.
- **minSdk:** o app usa `minSdk 21` por causa da incerteza sobre o Android da multimídia; versões recentes do SDK do Firebase podem exigir mais. Verificar antes de adotar.
- Sem limite de chamadas em `criarPagamento`, quem conhecer um `idmaq` poderia gerar cobranças em excesso (sem ganho para ele). Limitar por dispositivo.

## 12. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| F1 | Regras do Firestore e do Realtime Database, índices, contas de clientes de teste | Teste das regras no emulador passa (seção 4), inclusive "cliente A não vê nada do cliente B" |
| F2 | Painel: login, painel com os quatro contadores, dispositivos, cadastro com validação de `idmaq`, `ativo`, token do cliente | Um cliente cadastra um dispositivo, liga e desliga `ativo` e vê os contadores mudarem; outro cliente não o vê |
| F3 | Serviço de confiança: `espelharPresenca` e, em modo teste do Mercado Pago, `criarPagamento` e `webhookMP` | Um dispositivo de teste aparece Online e Offline sozinho; pagamento de teste cria `vendas` uma única vez, com o `dono` certo; reenvio de webhook não duplica |
| F4 | Relatório de vendas por dispositivo com exportação | Totais batem com a soma da lista |
| F5 | Equipamento ligado ao Firebase (presença, ativação por documento, pagamento, sessão) | Venda real de valor baixo registrada e conferida na conta do Mercado Pago do cliente |

## 13. Testes exigidos

- Regras do Firestore e do Realtime Database: anônimo não lê `segredos`/`clientes`/`vendas` e não lista; cliente não vê dados de outro cliente, não toma `idmaq` de outro e não grava `online`.
- Presença: tirar a energia do dispositivo, tirar a rede, religar e reabrir o app; `idmaq` não cadastrado é ignorado; os quatro contadores do painel acompanham sem recarregar.
- Webhook: aprovado, duplicado, assinatura inválida, valor diferente do do dispositivo, dispositivo `ativo=false`, venda gravada com o `dono` certo.
- Painel: `idmaq` inválido e já cadastrado por outro, troca de token sem exibir o antigo, relatório em fronteira de dia (23:59 e 00:00).
- Não declarar pronto sem uma venda real de valor baixo conferida no extrato do Mercado Pago, registrada em `docs/ESTADO-DO-PROJETO.md`.

## 14. Decisões

**Tomadas pelo dono em 05/10/2026:**
1. serviço de confiança em Node na VPS dele;
2. painel **web**;
3. "online" = internet + USB conectado;
4. "offline" detectado por `onDisconnect`, em segundos; no painel, Offline = Cadastrados − Online;
5. **sem admin único**: vários clientes, cada um vê só os seus dispositivos e vendas;
6. **contas criadas pelo dono** no console, sem cadastro aberto;
7. **token do Mercado Pago por cliente**;
8. **ninguém tem visão geral**;
9. **validação do dispositivo só pelo ID da tela**: o primeiro que cadastrar fica com ele.

**Divisão de trabalho:** neste repositório e nesta conversa só se constrói o **app de escanear** (equipamento). O painel web e o serviço Node são feitos à parte, seguindo este arquivo; aqui ele só é mantido atualizado e fiel ao que o app do equipamento espera. Qualquer mudança no contrato (coleções, campos, chamadas) deve ser registrada aqui para o outro lado.

**Ainda em aberto:** política de estorno (painel do Mercado Pago, fora deste app); obrigações fiscais da cobrança, com contador. LGPD: este desenho não guarda VIN nem relatório do cliente final no Firebase, só `idmaq`, `valor` e `data`.

## 15. Fora de escopo

Segundo fator de autenticação, perfis de acesso, auditoria, cartão e maquininha, assinatura mensal, conta do cliente final, nota fiscal, e qualquer leitura do veículo pelo painel.

## 16. Contrato HTTP do serviço de pagamento (o que o app do equipamento já chama)

O app usa o endereço base informado na compilação (`-PpaymentApiUrl=https://...`, sem barra no final). Vazio = "Servidor de pagamento não configurado" (falha fechada). **Sempre HTTPS.**

**`POST {base}/pagamentos`**
- Cabeçalhos: `Authorization: Bearer <ID token do login anônimo do Firebase>`, `Content-Type: application/json`.
- Corpo: `{"idmaq": "3F9A-12C0"}`.
- O serviço deve: validar o ID token com o Admin SDK; exigir `idmaq` no formato `XXXX-XXXX`; ler `dispositivos/{idmaq}` e exigir `ativo == true`; ler o token em `segredos/{dono do dispositivo}`; criar o PIX no Mercado Pago com o `valor` do documento (nunca um valor vindo do equipamento); gravar `pagamentos/{idInterno}` com `status: "pendente"`, `idmaq` e `dono`; limitar a frequência por `idmaq`.
- Sucesso (200 ou 201): `{"idInterno": "<uuid>", "valor": 2000, "pixCopiaECola": "<texto do PIX>", "expiraEm": 1790000000000}`. `valor` em centavos (inteiro) e `expiraEm` em milissegundos desde 1970. O app gera o QR Code a partir de `pixCopiaECola`.
- Erro (qualquer código fora de 2xx): `{"erro": "Mensagem curta em português, pode ser mostrada ao cliente."}`. Nunca devolver o token do Mercado Pago, nem detalhes internos.

**`POST {base}/pagamentos/{idInterno}/cancelar`** (mesmo cabeçalho; melhor esforço). Marca `cancelado` se ainda estiver `pendente`. Responde `{}`.

**Estados publicados em `pagamentos/{idInterno}`** (o app escuta esse documento): `pendente`, `aprovado` (só com `sessaoId` preenchido, um UUID novo), `expirado`, `cancelado`. O app só abre a sessão paga quando vê `aprovado` com `sessaoId`; pagamento aprovado exige o webhook ter consultado o Mercado Pago (seção 6).

**Limitação conhecida:** se o app cair depois do pagamento aprovado e antes de abrir a sessão, ele não recupera (as regras não deixam o equipamento listar `pagamentos`). Se isso importar, o serviço pode oferecer `GET {base}/pagamentos/pendentes?idmaq=` com o mesmo token, e o app passa a usar.

## 17. Dados de exemplo (sintéticos) para testar o painel e o app

O `idmaq` real aparece na tela do equipamento ("ID deste equipamento"); nos exemplos usa-se `3F9A-12C0` e o cliente `uidClienteA`.

```
Firestore clientes/uidClienteA
  { email: "cliente.a@exemplo.com", nome: "Lava-rápido Centro", tokenMPFinal: "…8912" }

Firestore segredos/uidClienteA           (somente escrita pelo próprio cliente)
  { tokenMP: "TEST-xxxxxxxxxxxxxxxx" }     ← usar token de TESTE do Mercado Pago em bancada

Firestore dispositivos/3F9A-12C0
  { idmaq: "3F9A-12C0", dono: "uidClienteA", nome: "Totem entrada", valor: 2000, ativo: true,
    online: false, ultimoSinal: null, criadoEm: <Timestamp do servidor> }

Firestore pagamentos/9b2c4f1e-0d7a-4c55-8e1b-5a2f6c3d7e90     (criado só pelo serviço)
  { idmaq: "3F9A-12C0", dono: "uidClienteA", valor: 2000, status: "pendente", criadoEm: <Timestamp> }
  → ao aprovar: status: "aprovado", sessaoId: "c1d5e6a2-7f3b-4a8e-9b10-2d4f6a8c0e12"

Firestore vendas/<idPagamento do Mercado Pago>                (criado só pelo webhook)
  { idmaq: "3F9A-12C0", dono: "uidClienteA", valor: 2000, data: <Timestamp do servidor>, idPagamento: "<id do MP>" }

Realtime Database presenca/3F9A-12C0
  { online: true, ts: 1790000000000 }
```

Para testar a separação: criar duas contas de cliente e conferir que cada uma vê só os próprios dispositivos e vendas. As contas (e-mail e senha) são criadas **pelo dono no console do Firebase**; senhas nunca entram neste repositório.

## 18. Como gerar o APK com a nuvem

```
cd android
./gradlew assembleRelease -PbillingMode=live -PpaymentApiUrl=https://SEU-DOMINIO
```

Sem `-PbillingMode` (ou `off`) o APK sai como o validado: sem Firebase, sem permissão INTERNET. As compilações `live` e `demo` incluem Firebase (Auth anônimo, Firestore, Realtime Database) e a biblioteca de QR.

## 19. Registro da implementação do serviço (05/10/2026)

Serviço feito em `servico/` (Node + Firebase Admin SDK), seguindo as seções 6 e 16. O contrato com o equipamento não mudou. Acréscimos, todos invisíveis para o app do equipamento:

- `pagamentos/{idInterno}` ganha `mpId` (id do pagamento no Mercado Pago), `expiraEm` (Timestamp), `aprovadoEm` e, quando algo foge do normal, `alerta` (texto para conferência manual). O equipamento continua lendo só `status` e `sessaoId`.
- `segredos/{uid}.webhookSecret` (opcional): assinatura secreta da aplicação do Mercado Pago do cliente. A assinatura é por aplicação, e cada cliente tem a própria; quando o campo existe, o webhook recusa avisos com assinatura inválida. **Em aberto (dono):** criar no painel um campo para o cliente informar esse segredo. A segurança do pagamento não depende disso, porque a aprovação sempre consulta o Mercado Pago com o token do dono.
- `notification_url` de cada PIX: `{URL_PUBLICA}/webhook/mp?ref={idInterno}`.
- **Conciliação a cada 20 s** dos pagamentos `pendente`: aprova o que o Mercado Pago já aprovou (cobre aviso perdido e pagamentos com credenciais de teste, que não geram notificação, segundo a documentação) e marca `expirado` o que venceu, cancelando o PIX no Mercado Pago.
- Validade do PIX: 31 minutos (a API exige no mínimo 30). O equipamento pode cancelar antes por `POST /pagamentos/{idInterno}/cancelar`.
- Pagamento aprovado no Mercado Pago depois de ficar `expirado`/`cancelado` aqui, ou com o dispositivo desligado depois do PIX: a venda é registrada (o dinheiro entrou e o relatório precisa bater com o extrato), mas a sessão não é aberta; o pagamento recebe `alerta`.
- Valor aprovado diferente do esperado: não aprova, não cria venda, grava `alerta`.
