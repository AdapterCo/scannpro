# Instruções para criar o painel web dos clientes do ScannPro (Firebase + Mercado Pago)

Instrução de 05/10/2026, escrita para quem for construir (pessoa ou agente de IA). Revisada no mesmo dia: **não existe admin único**. Cada cliente tem o próprio login, cadastra e valida os próprios dispositivos e vê só os dispositivos e as vendas dele. **Não há servidor:** o próprio app da central cria o PIX no Mercado Pago, consulta o pagamento e grava a venda. Cada central fica **vinculada** ao seu `idmaq`, e só a central vinculada lê o token do cliente e grava vendas. Onde estiver "em aberto", pergunte ao dono antes de seguir. O fluxo do cliente final no equipamento está em `docs/SESSAO-E-PAGAMENTO.md`.

## 1. O que o dono pediu

- **Vários logins**, com e-mail e senha (Firebase Authentication). **As contas são criadas pelo dono**, no console do Firebase; não há cadastro aberto.
- Cada cliente **cadastra e valida os próprios dispositivos** pelo `idmaq`, o ID que o equipamento mostra na tela.
- Cada cliente **vê apenas os seus** dispositivos e as suas vendas. **Ninguém tem visão geral** de todos os clientes.
- **Token do Mercado Pago: um por cliente.** O cliente informa o token dele uma vez, e todos os dispositivos dele cobram nessa conta.
- **Pagamento feito direto pelo app da central**, com a API do Mercado Pago e consulta periódica do pagamento, sem servidor.
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

1. **Cada dispositivo e cada venda leva o campo `dono`** (o `uid` do cliente). É isso que separa os dados de um cliente dos de outro.
2. **O `tokenMP` fica fora do documento do dispositivo e é do cliente, não do dispositivo.** Fica em `segredos/{uid do cliente}`. O cliente só escreve (não lê de volta). Quem lê é **somente a central vinculada a um dispositivo desse cliente** (item 7), na hora de cobrar. O documento `clientes/{uid}` guarda só `tokenMPFinal` (últimos 4 caracteres). O risco que sobra está na seção 11.
3. **Validação do dispositivo: só o ID da tela, o primeiro que cadastrar fica com ele.** Se o ID já pertence a outro cliente, o cadastro é recusado.
4. **Online/offline vem da presença do Realtime Database** (`presenca/{idmaq}`), que o painel lê direto. O Firestore não guarda `online`: sem servidor, ninguém copiaria a presença para lá.
5. **`valor` em centavos, número inteiro** (2000 = R$ 20,00), no dispositivo e na venda.
6. **Campo acrescentado:** `idPagamento` na venda (o número do pagamento no Mercado Pago), usado como ID do documento para uma venda nunca ser gravada duas vezes.
7. **Vínculo central ↔ `idmaq`.** Na primeira vez que abre, a central grava `vinculos/{idmaq}` com o `uid` do login anônimo dela (só pode ser criado uma vez) e `equipamentos/{uid}` com o `idmaq`. As regras só liberam o token e a gravação de vendas para o `uid` vinculado. Quem souber o `idmaq` pela tela e fizer login de outro lugar é recusado.

## 3. Dados

**Firestore**

| Documento | Campos | Quem lê | Quem escreve |
|---|---|---|---|
| `clientes/{uid}` | `email`, `nome`, `tokenMPFinal` | o próprio cliente | o próprio cliente |
| `segredos/{uid}` | `tokenMP` | só a central vinculada a um dispositivo desse cliente, por `get` | o próprio cliente (somente escrita) |
| `dispositivos/{idmaq}` | `idmaq` (texto, igual ao ID do documento), `dono` (uid), `nome`, `valor` (centavos, inteiro), `ativo` (booleano), `criadoEm` | o dono; o equipamento por `get` do próprio documento | o dono |
| `vendas/{idPagamento}` | `idmaq`, `dono`, `valor` (centavos), `data` (Timestamp do servidor), `idPagamento` | o dono | só a central vinculada ao `idmaq`, depois de o Mercado Pago confirmar o pagamento |
| `vinculos/{idmaq}` | `uid` (login anônimo da central) | centrais (login anônimo) | a própria central, uma única vez; nunca alterado nem apagado pelo app |
| `equipamentos/{uid}` | `idmaq` | a própria central | a própria central, só se `vinculos/{idmaq}` for dela |

**Realtime Database** (só para presença)

| Caminho | Campos | Quem escreve | Quem lê |
|---|---|---|---|
| `presenca/{idmaq}` | `online` (booleano), `ts` (hora do servidor) | o equipamento, e o próprio servidor do Firebase ao detectar a queda (`onDisconnect`) | os clientes (painel) |

Regras do ID: `idmaq` no formato `XXXX-XXXX` (8 hexadecimais maiúsculos, o que o equipamento mostra).

## 4. Regras de segurança

O equipamento entra com **login anônimo**; os clientes entram com **e-mail e senha**. As regras distinguem os dois pelo provedor de login.

**Firestore**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function logado()   { return request.auth != null; }
    function anonimo()  { return logado() && request.auth.token.firebase.sign_in_provider == 'anonymous'; }
    function cliente()  { return logado() && request.auth.token.firebase.sign_in_provider == 'password'; }
    function meu(dados) { return cliente() && dados.dono == request.auth.uid; }
    function dispositivo(idmaq) { return get(/databases/$(db)/documents/dispositivos/$(idmaq)).data; }
    // A central vinculada ao idmaq é a que gravou vinculos/{idmaq} com o próprio uid anônimo.
    function vinculada(idmaq) {
      return anonimo() && exists(/databases/$(db)/documents/vinculos/$(idmaq))
             && get(/databases/$(db)/documents/vinculos/$(idmaq)).data.uid == request.auth.uid;
    }

    match /clientes/{uid} {
      allow get: if cliente() && request.auth.uid == uid;
      allow create, update: if cliente() && request.auth.uid == uid
                            && request.resource.data.keys().hasOnly(['email', 'nome', 'tokenMPFinal']);
      allow list, delete: if false;
    }
    match /segredos/{uid} {
      allow create, update: if cliente() && request.auth.uid == uid;   // o cliente só escreve
      // Só a central vinculada a um dispositivo deste cliente lê o token para cobrar.
      allow get: if anonimo()
                 && exists(/databases/$(db)/documents/equipamentos/$(request.auth.uid))
                 && dispositivo(get(/databases/$(db)/documents/equipamentos/$(request.auth.uid)).data.idmaq).dono == uid;
      allow list, delete: if false;
    }
    match /vinculos/{idmaq} {
      allow get: if anonimo();
      allow create: if anonimo()
                    && idmaq.matches('^[0-9A-F]{4}-[0-9A-F]{4}$')
                    && request.resource.data.keys().hasOnly(['uid'])
                    && request.resource.data.uid == request.auth.uid;
      allow list, update, delete: if false;                            // o primeiro vínculo fica; o dono corrige pelo console
    }
    match /equipamentos/{uid} {
      allow get: if anonimo() && request.auth.uid == uid;
      allow create, update: if anonimo() && request.auth.uid == uid
                            && request.resource.data.keys().hasOnly(['idmaq'])
                            && vinculada(request.resource.data.idmaq);
      allow list, delete: if false;
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
                    && request.resource.data.ativo is bool;
      allow update: if meu(resource.data)
                    && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['dono', 'idmaq'])
                    && request.resource.data.valor is int && request.resource.data.valor > 0
                    && request.resource.data.ativo is bool;
      allow delete: if meu(resource.data);
    }
    match /vendas/{id} {
      allow read: if meu(resource.data);
      // Só a central vinculada grava a venda, depois de confirmar no Mercado Pago; dono e valor batem com o cadastro.
      allow create: if vinculada(request.resource.data.idmaq)
                    && request.resource.data.keys().hasOnly(['idmaq', 'dono', 'valor', 'data', 'idPagamento'])
                    && request.resource.data.idPagamento == id
                    && request.resource.data.data == request.time
                    && dispositivo(request.resource.data.idmaq).dono == request.resource.data.dono
                    && dispositivo(request.resource.data.idmaq).valor == request.resource.data.valor;
      allow update, delete: if false;
    }
  }
}
```

Toda consulta de lista do painel (`dispositivos`, `vendas`) precisa ter `where('dono', '==', uid)`, senão o Firestore recusa.

**Realtime Database** (presença):

```
{
  "rules": {
    "presenca": {
      "$idmaq": {
        ".read": "auth != null && auth.token.firebase.sign_in_provider == 'password'",
        ".write": "auth != null && $idmaq.matches(/^[0-9A-F]{4}-[0-9A-F]{4}$/)",
        ".validate": "newData.hasChildren(['online', 'ts'])"
      }
    }
  }
}
```

Teste tudo no emulador do Firebase antes de publicar: um usuário anônimo **não** lê `clientes` nem `vendas`, não lista nada e não altera dispositivos; um usuário anônimo que **não** é a central vinculada não lê `segredos`, não grava `vendas` e não consegue vincular um `idmaq` que já tem vínculo. Um cliente **não** lê nem lista dispositivos ou vendas de outro cliente, não toma para si um `idmaq` que já é de outro e não lê `segredos`. Desative o cadastro público em Authentication: só o dono cria contas.

## 5. Telas e critérios de aceite

1. **Login.** E-mail e senha, "esqueci a senha" (e-mail de redefinição do Firebase), sair. Não há tela de criar conta. *Aceite:* um cliente nunca vê dados de outro.
2. **Painel (tela inicial).** Quatro cartões dos dispositivos **do cliente logado**, atualizados sozinhos em tempo real: **Cadastrados**, **Ativos**, **Online**, **Offline**. Abaixo, a lista "Ativos fora do ar", com "offline desde" a partir de `presenca/{idmaq}.ts`. Tocar num cartão abre a lista filtrada. Definições: Cadastrados = dispositivos com `dono == uid`; Ativos = `ativo == true`; Online = `presenca/{idmaq}.online == true`; Offline = Cadastrados − Online (sem `presenca/{idmaq}` conta como offline). O painel escuta `presenca/{idmaq}` de cada dispositivo do cliente. *Aceite:* ao desligar a energia de um dispositivo online, em até cerca de 1 a 2 minutos ele passa de Online para Offline sem o cliente tocar em nada; ao religar, volta.
3. **Dispositivos.** Lista com nome, `idmaq`, valor, interruptor **Ativo**, bolinha de estado (verde online, vermelha offline) e vendas de hoje. *Aceite:* mudar o interruptor grava `ativo` e o equipamento reage em segundos.
4. **Cadastrar (validar) e editar dispositivo.** Campos: `idmaq` (validação de formato), `nome`, `valor` (digitado em reais, gravado em centavos, inteiro maior que zero), `ativo`. *Aceite:* `idmaq` fora do formato é recusado; `idmaq` que já pertence a outro cliente é recusado com "Este dispositivo já está cadastrado"; o equipamento sai de "Aguardando ativação" quando o cadastro é salvo com `ativo` ligado.
5. **Conta e token do Mercado Pago.** O cliente informa o `tokenMP` (campo de senha) uma vez; salvar grava `segredos/{uid}` e `tokenMPFinal` em `clientes/{uid}` juntos (lote). O token nunca é exibido depois de salvo; para trocar, digitar outro. *Aceite:* sem token configurado, o painel avisa que os dispositivos não conseguem cobrar.
6. **Relatório de vendas por dispositivo.** Escolher o dispositivo e o período (hoje, 7 dias, 30 dias, mês, intervalo livre). Mostra total vendido, quantidade, ticket médio e lista (data, valor). Visão "todos os meus dispositivos": uma linha por dispositivo com total e quantidade, e o total geral. Exportar CSV. *Aceite:* os totais batem com a soma da lista; o dia vai de 00:00 a 23:59 em `America/Sao_Paulo`.

Interface em português do Brasil, valores em R$, estados vazio/carregando/erro de rede em todas as telas. As consultas por `dono` combinadas com `idmaq` e intervalo de `data` exigem índices compostos; o Firestore mostra o link para criá-los na primeira execução.

## 6. Pagamento direto pelo app da central (sem servidor)

**Decisão do dono (05/10/2026, noite):** o app da central cria o PIX e acompanha o pagamento sozinho, direto na API do Mercado Pago. Não há serviço na VPS, webhook nem Cloud Functions. Já implementado no app da central (versão de nuvem):

1. O cliente final toca em "Pagar com PIX".
2. A central confirma o vínculo (`vinculos/{idmaq}` e `equipamentos/{uid}`, criados na primeira abertura) e lê `dispositivos/{idmaq}` no servidor (`dono`, `valor`, `ativo`) e `segredos/{dono}.tokenMP`.
3. `POST https://api.mercadopago.com/v1/payments` com `Authorization: Bearer <tokenMP>`, `X-Idempotency-Key` aleatório e corpo `{transaction_amount: valor/100, description, payment_method_id: "pix", external_reference: idmaq, date_of_expiration: agora + 10 min, payer: {email}}`. O texto "copia e cola" vem em `point_of_interaction.transaction_data.qr_code`, e a central desenha o QR com ele.
4. A central consulta `GET /v1/payments/{id}` a cada 5 segundos. `approved` grava `vendas/{id}` e abre a sessão; `cancelled`/`rejected`/`refunded`/`charged_back` voltam à tela de pagamento.
5. "Cancelar" ou o fim dos 10 minutos manda `PUT /v1/payments/{id}` com `{status: "cancelled"}`.

O token fica só na memória da central durante a cobrança; não é gravado no aparelho. Os campos da API foram conferidos no SDK oficial `mercadopago/sdk-nodejs` em 05/10/2026.

**Presença:** sem servidor, o painel lê `presenca/{idmaq}` direto no Realtime Database (seção 4). O Realtime Database tem `onDisconnect`: o servidor do Firebase grava "offline" quando a conexão cai, sem laço no equipamento.

## 7. Como o equipamento usa o Firebase

- Entra com **login anônimo** (não tem e-mail e senha). O login fica guardado no aparelho; um usuário anônimo por instalação.
- **Vínculo:** na primeira abertura grava `vinculos/{idmaq}` = seu `uid` e `equipamentos/{uid}` = `idmaq`. Se o `idmaq` já estiver vinculado a outro `uid`, a central não cobra e mostra "Este equipamento não tem permissão para cobrar".
- **Presença:** ao ficar conectado, grava `presenca/{idmaq}.online = true` e registra `onDisconnect` para gravar `false`. Nenhum laço de envio. **Decisão do dono: "online" = equipamento com internet E módulo USB (leitor) conectado.** O app só mantém `presenca/{idmaq}.online = true` enquanto as duas condições valem; ao soltar o USB grava `false` (sem laço: reage ao evento de USB conectado/removido que o app já recebe). A impressora não entra na conta. Quando a internet cai, quem marca offline é o `onDisconnect`, em segundos.
- **Ativação sem código:** a tela mostra o `idmaq` e "Aguardando ativação". Quando o cliente cadastra o dispositivo e liga `ativo`, o equipamento, que ouve o próprio documento (escuta em tempo real, sem varredura), recebe `nome` e `valor` e vai para a tela de pagamento. Desligar `ativo` volta o equipamento a "não ativado".
- **Pagamento:** como na seção 6. Com o pagamento aprovado, abre a sessão (regras de 2 escaneamentos, 2 impressões e 5 minutos já implementadas no app).
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

## 9. Configuração do Firebase (passo a passo para o dono)

1. Ativar **Authentication > E-mail/senha** e **Login anônimo**; desativar o cadastro público de usuários. 2. Para cada cliente, criar a conta (e-mail e senha) em Authentication. 3. Ativar o **Firestore** em modo produção e publicar as regras da seção 4. 4. Ativar o **Realtime Database** e publicar as regras de presença.

## 10. O que não fazer

- Não colocar o `tokenMP` em `dispositivos`, em `clientes`, em `BuildConfig`, no APK, nem em log. Ele fica só em `segredos/{uid}`.
- Não deixar regras abertas (`allow read, write: if true`) nem modo de teste do Firestore ou do Realtime Database.
- Não abrir sessão paga sem o `GET /v1/payments/{id}` do Mercado Pago responder `approved`.
- Não exibir o token de volta no painel.
- Não fazer consulta de lista sem filtrar por `dono`.
- **Não apagar os usuários anônimos das centrais** no Authentication: a central perde o vínculo e deixa de cobrar. Para recuperar, apagar `vinculos/{idmaq}` e `equipamentos/{uid antigo}` pelo console e reabrir o app.

## 11. Limitações conhecidas (consequências das decisões do dono)

- **O token do Mercado Pago fica acessível à central vinculada.** Pela internet, só a central vinculada a um dispositivo do cliente lê o token. Quem tiver acesso físico à central e conhecimento técnico (root, depuração) ainda pode extraí-lo do aparelho durante uma cobrança. Foi a troca aceita pelo dono ao escolher o pagamento direto no app, sem servidor.
- **Venda forjada só pela própria central:** só a central vinculada grava `vendas`, com o dono e o valor do cadastro. A conferência final continua sendo o extrato do Mercado Pago.
- **Corrida no primeiro vínculo:** o vínculo fica com o primeiro que gravar `vinculos/{idmaq}`. A central grava na primeira abertura, antes de o ID ser mostrado a alguém; outra pessoa precisaria adivinhar um ID de 8 dígitos hexadecimais antes disso.
- **Validação só pelo ID da tela:** quem enxergar o ID na tela de um equipamento pode cadastrá-lo antes do cliente certo. O dono corrige pelo console (apaga o documento em `dispositivos`).
- **Pagamento aprovado sem sessão:** se a central desligar ou o app fechar depois de o cliente pagar e antes da próxima consulta, a sessão não abre e a venda não é gravada (o dinheiro está no Mercado Pago). Com a central ligada, a venda gravada sem internet fica guardada no aparelho e é enviada quando a internet voltar.
- **A presença é informativa e pode ser forjada** por quem souber o `idmaq`.
- **Tempo para aparecer offline:** com queda de energia sem desligar a rede de forma limpa, o servidor demora para perceber (da ordem de um minuto; medir na prática).
- **Trocar de aparelho ou apagar os dados do app gera um `idmaq` novo**: é preciso cadastrar o dispositivo de novo.
- **E-mail do pagador:** a API exige um e-mail; a central envia um fixo (`cliente@scannpro.com.br`), porque o cliente do totem não informa o dele.

## 12. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| F1 | Regras do Firestore e do Realtime Database, índices, contas de clientes de teste | Teste das regras no emulador passa (seção 4), inclusive "cliente A não vê nada do cliente B" |
| F2 | Painel: login, painel com os quatro contadores (presença lida do Realtime Database), dispositivos, cadastro com validação de `idmaq`, `ativo`, token do cliente | Um cliente cadastra um dispositivo, liga e desliga `ativo` e vê os contadores mudarem; outro cliente não o vê |
| F3 | Relatório de vendas por dispositivo com exportação | Totais batem com a soma da lista |
| F4 | Venda real de valor baixo pela central | Venda registrada em `vendas` e conferida na conta do Mercado Pago do cliente |

## 13. Testes exigidos

- Regras do Firestore e do Realtime Database: anônimo não lê `clientes`/`vendas` e não lista; cliente não vê dados de outro cliente, não toma `idmaq` de outro e não lê `segredos`; venda com `valor` ou `dono` diferentes do cadastro é recusada; anônimo não vinculado não lê `segredos` nem grava `vendas`; segundo vínculo do mesmo `idmaq` é recusado.
- Presença: tirar a energia do dispositivo, tirar a rede, religar e reabrir o app; os quatro contadores do painel acompanham sem recarregar.
- Pagamento: aprovado, cancelado na tela, expirado (10 minutos), token inválido, sem internet.
- Painel: `idmaq` inválido e já cadastrado por outro, troca de token sem exibir o antigo, relatório em fronteira de dia (23:59 e 00:00).
- Não declarar pronto sem uma venda real de valor baixo conferida no extrato do Mercado Pago, registrada em `docs/ESTADO-DO-PROJETO.md`.

## 14. Decisões

**Tomadas pelo dono em 05/10/2026:**
1. painel **web**;
2. "online" = internet + USB conectado;
3. "offline" detectado por `onDisconnect`, em segundos; no painel, Offline = Cadastrados − Online;
4. **sem admin único**: vários clientes, cada um vê só os seus dispositivos e vendas;
5. **contas criadas pelo dono** no console, sem cadastro aberto;
6. **token do Mercado Pago por cliente**;
7. **ninguém tem visão geral**;
8. **validação do dispositivo só pelo ID da tela**: o primeiro que cadastrar fica com ele;
9. **pagamento direto no app da central, sem servidor**. Substitui a decisão anterior de um serviço Node na VPS;
10. **token não exposto pela internet**: só a central vinculada ao `idmaq` lê o token e grava vendas.

**Divisão de trabalho:** neste repositório e nesta conversa só se constrói o **app de escanear** (equipamento). O painel web é feito à parte, seguindo este arquivo; aqui ele só é mantido atualizado e fiel ao que o app do equipamento espera. Qualquer mudança no contrato (coleções, campos, chamadas) deve ser registrada aqui para o outro lado.

**Ainda em aberto:** política de estorno (painel do Mercado Pago, fora deste app); obrigações fiscais da cobrança, com contador. LGPD: este desenho não guarda VIN nem relatório do cliente final no Firebase, só `idmaq`, `valor` e `data`.

## 15. Fora de escopo

Segundo fator de autenticação, perfis de acesso, auditoria, cartão e maquininha, assinatura mensal, conta do cliente final, nota fiscal, e qualquer leitura do veículo pelo painel.

## 16. Dados de exemplo (sintéticos) para testar o painel e o app

O `idmaq` real aparece na tela do equipamento ("ID deste equipamento"); nos exemplos usa-se `3F9A-12C0` e o cliente `uidClienteA`.

```
Firestore clientes/uidClienteA
  { email: "cliente.a@exemplo.com", nome: "Lava-rápido Centro", tokenMPFinal: "…8912" }

Firestore segredos/uidClienteA           (escrito pelo cliente; lido só pela central vinculada)
  { tokenMP: "TEST-xxxxxxxxxxxxxxxx" }     ← usar token de TESTE do Mercado Pago em bancada

Firestore dispositivos/3F9A-12C0
  { idmaq: "3F9A-12C0", dono: "uidClienteA", nome: "Totem entrada", valor: 2000, ativo: true,
    criadoEm: <Timestamp do servidor> }

Firestore vendas/<id do pagamento no Mercado Pago>            (gravado pela central)
  { idmaq: "3F9A-12C0", dono: "uidClienteA", valor: 2000, data: <Timestamp do servidor>, idPagamento: "<id do MP>" }

Firestore vinculos/3F9A-12C0                 (gravado pela central na primeira abertura)
  { uid: "uidAnonimoDaCentral" }

Firestore equipamentos/uidAnonimoDaCentral   (gravado pela central)
  { idmaq: "3F9A-12C0" }

Realtime Database presenca/3F9A-12C0
  { online: true, ts: 1790000000000 }
```

Para testar a separação: criar duas contas de cliente e conferir que cada uma vê só os próprios dispositivos e vendas. As contas (e-mail e senha) são criadas **pelo dono no console do Firebase**; senhas nunca entram neste repositório.

## 17. Como gerar o APK com a nuvem

```
cd android
./gradlew assembleRelease -PbillingMode=live
```

Sem `-PbillingMode` (ou `off`) o APK sai como o validado: sem Firebase, sem permissão INTERNET. As compilações `live` e `demo` incluem Firebase (Auth anônimo, Firestore, Realtime Database) e a biblioteca de QR.

## 18. Controle pelo celular durante a sessão paga

**Decisão do dono (11/10/2026):** por comodidade, o cliente final usa as funções da sessão pelo próprio celular, de dentro do carro, sem entrar e sair. A **leitura do veículo continua por cabo** (totem ↔ carro); o celular só envia pedidos e vê os resultados pela internet. A página do celular é construída **no projeto do painel web**. O lado do totem já está implementado (compilado, não testado).

**Fluxo**
1. O cliente paga; a sessão abre.
2. O totem cria `controles/{código}` e mostra, na faixa da sessão, um QR com `{URL_DO_PAINEL}/c/{código}`. O código tem 32 hexadecimais aleatórios e vale só para aquela sessão.
3. O celular abre a página (sem login, sem instalar nada), lê o documento em tempo real e envia pedidos.
4. Quando a sessão termina (tempo, limites usados ou "Encerrar"), o totem apaga o documento; a página mostra "Sessão encerrada".

**`controles/{código}`** (escrito só pelo totem; lido por quem tem o link)

| Campo | Conteúdo |
|---|---|
| `idmaq`, `uidTotem`, `sessaoId`, `ativa`, `criadoEm`, `atualizadoEm` | identificação |
| `expiraEm` | Timestamp em que a sessão termina por inatividade |
| `escaneamentosRestantes`, `impressoesRestantes` | limites da sessão |
| `sistemaOnline`, `veiculoConectado`, `ocupado`, `mensagem` | situação do totem e texto que ele mostra |
| `podeEscanear`, `podeLimpar`, `podeImprimir` | quais botões a página habilita |
| `statusConfirmados`, `statusPendentes`, `statusLimpeza` | resumo das leituras |
| `dtcs` | lista de `{codigo, pendente, titulo, gravidade, descricao, causas}` |
| `sensores` | lista de `{nome, valor (número ou null), unidade}` |

**Sem VIN e sem relatório para baixar (decisão do dono):** o celular só mostra os resultados e manda imprimir no totem. Nenhum dado de identificação do veículo vai para a nuvem.

**`controles/{código}/comandos/{id}`** (criado pelo celular)

```
{ acao: "escanear" | "limpar" | "imprimir", confirmado: true|false, criadoEm: <hora do servidor> }
```

- `limpar` só é aceito com `confirmado: true`; a página **pede confirmação** antes ("Apagar os códigos de falha da central do veículo?").
- O totem executa como se o botão dele fosse tocado, com os mesmos limites (2 escaneamentos, 2 impressões), e **apaga o pedido** depois. O resultado aparece no próprio `controles/{código}`.
- Pedido com o totem ocupado é descartado; a página deve desabilitar os botões enquanto `ocupado` for verdadeiro.

**Regras (acrescentar às do Firestore da seção 4)**

```
    match /controles/{codigo} {
      allow get: if true;                                              // quem tem o link vê; não há listagem
      allow create: if anonimo() && request.resource.data.uidTotem == request.auth.uid;
      allow update, delete: if anonimo() && resource.data.uidTotem == request.auth.uid;
      allow list: if false;
      match /comandos/{id} {
        allow create: if get(/databases/$(db)/documents/controles/$(codigo)).data.ativa == true
                      && request.time < get(/databases/$(db)/documents/controles/$(codigo)).data.expiraEm
                      && request.resource.data.keys().hasOnly(['acao', 'confirmado', 'criadoEm'])
                      && request.resource.data.acao in ['escanear', 'limpar', 'imprimir']
                      && request.resource.data.confirmado is bool
                      && request.resource.data.criadoEm == request.time
                      && (request.resource.data.acao != 'limpar' || request.resource.data.confirmado == true);
        allow read, delete: if anonimo()
                            && get(/databases/$(db)/documents/controles/$(codigo)).data.uidTotem == request.auth.uid;
        allow update: if false;
      }
    }
```

**Página do celular (painel web), rota `/c/{código}`:**
- tempo restante;
- escaneamentos e impressões restantes;
- botões Escanear, Limpar falhas (com confirmação) e Imprimir no totem, habilitados conforme `pode*`;
- mensagem do totem;
- falhas com título e causas;
- sensores.

Sem login. Documento inexistente = "Sessão encerrada ou link inválido". Interface em português, pensada para tela de celular.

**APK do totem:** `-PpainelUrl=https://ENDERECO-DO-PAINEL`. Sem esse endereço o totem não mostra o QR nem cria `controles`.

**Limitações:** o link dá controle da sessão a quem o tiver durante a sessão. O cliente pode repassá-lo, e quem estiver ao lado do totem pode fotografar o QR. Ninguém consegue mais do que a sessão permite, e o acesso acaba com ela.
