# ScannPro Painel (painel web dos clientes)

Painel web dos clientes do ScannPro, feito conforme `ADMIN-APP-INSTRUCOES.md` (fases F1, F2 e F4). React + Vite + Firebase (Auth, Firestore).

**Não há admin.** Cada cliente entra com o próprio e-mail e senha (contas criadas pelo dono no console) e vê só os próprios dispositivos e vendas (campo `dono` = uid).

- **Login** com e-mail e senha e "esqueci a senha". Não há tela de criar conta.
- **Painel**: Cadastrados, Ativos, Online e Offline do cliente, em tempo real, e a lista "Ativos fora do ar". Avisa quando o token não está configurado.
- **Dispositivos**: lista com estado, valor, vendas de hoje e interruptor **Ativo**.
- **Cadastrar (validar) dispositivo** pelo `idmaq` da tela: o primeiro cliente que cadastrar fica com ele. Se o ID já for de outro, aparece "Este dispositivo já está cadastrado".
- **Conta**: nome e **token do Mercado Pago, um por cliente**. Vai para `segredos/{uid}` (somente escrita, nunca exibido); `clientes/{uid}` guarda só `tokenMPFinal`.
- **Relatório**: por dispositivo ou "todos os meus dispositivos"; hoje, 7 dias, 30 dias, mês ou intervalo (fuso `America/Sao_Paulo`). Exporta CSV.

O serviço de confiança (Node na VPS: `criarPagamento`, `webhookMP`, espelho de presença, seção 6) está em [`servico/`](servico/README.md), com instruções de instalação. Testes: `npm run test:servico`.

## Comandos

```bash
npm install
npm test               # testes unitários (centavos, fuso, CSV)
npm run test:regras    # regras do Firestore e do Realtime Database no emulador (exige Java 21)
npm run build          # gera dist/
```

O Firebase CLI exige **Java 21**. Nesta máquina ele está em `C:\Program Files\Java\jdk-21`; se o padrão for o 17, rode antes no Git Bash:

```bash
export JAVA_HOME="/c/Program Files/Java/jdk-21"; export PATH="$JAVA_HOME/bin:$PATH"
```

## Publicar (projeto `adapterdb-aba6f`)

1. No console (seção 9): ative **E-mail/senha** e **Anônimo**, desative o cadastro público e crie uma conta para cada cliente.
2. Publique as regras e os índices. **Faça isso já**: o Realtime Database está em modo de teste, com leitura pública.
   ```bash
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes,database
   ```
3. Hospede o painel: `npm run build` e depois `npx firebase deploy --only hosting`, ou copie `dist/` para a VPS (servidor estático, redirecionando rotas para `index.html`). Se usar um domínio próprio, adicione-o em Authentication > Configurações > Domínios autorizados.

O emulador não exige índices compostos. No projeto real, as consultas por `dono` + `data` (e + `idmaq`) só funcionam depois de publicar `firestore.indexes.json`.
