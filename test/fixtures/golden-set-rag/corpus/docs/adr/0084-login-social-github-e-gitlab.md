# ADR 0084 — Login social (GitHub/GitLab), revisando o backlog dos ADRs 0031/0032

## Contexto

O ADR 0031 (auth first-party) e o ADR 0032 (corte do Keycloak) colocaram
**login social** explicitamente no backlog consciente: "o Keycloak os
oferecia e não eram usados; reimplementá-los agora seria pagar o custo sem a
demanda." O `CLAUDE.md` transformou essa decisão em proibição permanente —
"Não implementar (…) login social" — e o `docs/explanation/backlog.md`
manteve o item como pendência aberta desde a FASE 13c.

O dono do produto pediu explicitamente esta frente, ciente das
consequências de segurança envolvidas, e por isso a proibição foi
revogada PARA ESTA FRENTE — não retroativamente para MFA, OIDC provider ou
federação, que continuam fora de escopo (ver Consequências).

O produto já tem DOIS pedaços do mecanismo, para dois propósitos
diferentes:

1. **Auth first-party** (ADR 0031/0032): `EmitirSessaoUseCase` empacota o
   par access (Ed25519, curto) + refresh (opaco, rotação com família) depois
   que a identidade já foi resolvida — usado por `LoginUseCase` e
   `RegisterUseCase` hoje.
2. **OAuth de GitHub/GitLab** (Fase 2, ADR 0059): `GitOauthClient`
   (`buildAuthorizeUrl`/`exchangeCode`), `GitOauthClientRegistry`,
   `signOauthState`/`verifyOauthState` assinado por `GIT_OAUTH_STATE_SECRET`
   — mas para **conectar uma credencial de git a um projeto de um usuário JÁ
   AUTENTICADO** (`StartGitOauthUseCase` exige `projectId` e `userId`).

O trabalho desta frente é ligar os dois SEM inventar um terceiro formato de
sessão nem misturar os dois propósitos de `state`.

## Decisão

### 1. O mecanismo de emissão de sessão é reusado, sem exceção

`SocialLoginCallbackUseCase` termina chamando o MESMO `EmitirSessaoUseCase`
que `LoginUseCase`/`RefreshUseCase` usam. Não existe um segundo formato de
token, cookie ou claim para quem entra por GitHub/GitLab — a sessão de quem
loga por senha e a de quem loga por OAuth são **indistinguíveis** depois de
emitidas.

### 2. O cliente OAuth é reusado; o propósito do `state`, NÃO

`GitOauthClient` ganhou dois métodos novos —
`buildLoginAuthorizeUrl`/`fetchIdentity` — implementados pelos MESMOS
`GithubOauthClient`/`GitlabOauthClient` do fluxo de conexão de git.
`exchangeCode` é reusado tal como está.

O que NÃO é reusado é a assinatura do `state`. `domain/auth/social-oauth-state.ts`
é um módulo PRÓPRIO, com payload estruturalmente diferente
(`{purpose: 'social_login', provider, nonce, expiresAt}`, sem `projectId`
nem `userId` — não existe "onde" para login social, só identidade) e um
discriminante de PROPÓSITO checado ANTES de qualquer outro campo
([RN-273](../business-rules.md#rn-273)). Um `state` do fluxo de CONEXÃO de
git, mesmo assinado pela MESMA chave, não é aceito aqui — e a suíte prova a
direção que importava (git-connect state → verificador de login social):
aceitar aquele `state` no callback de LOGIN teria significado logar como
`userId` de outra pessoa, escalação de privilégio pura.

A chave HMAC continua sendo `GIT_OAUTH_STATE_SECRET`
(`resolveOauthStateSecret()`) — **nenhuma variável de ambiente nova**. Reusar
a chave é seguro porque a incompatibilidade estrutural do payload, e não o
segredo, é o que separa os dois propósitos.

### 3. Escopo mínimo, próprio do login

`buildLoginAuthorizeUrl` pede `read:user user:email` (GitHub) e `read_user`
(GitLab) — nunca o `repo`/`api` do fluxo de conexão. Entrar na conta não
deveria conceder acesso a repositório nenhum
([RN-277](../business-rules.md#rn-277)).

### 4. Tabela nova: `social_identities`

Migração `0047`. Coluna dedicada em `users` foi rejeitada pelo motivo que
`keycloak_sub` já ensina: uma coluna por provider legado não escala para
DOIS providers simultâneos (um usuário pode logar por GitHub e GitLab ao
mesmo tempo). `(provider, provider_user_id)` é único; `provider_user_id` é o
id NUMÉRICO do provider, nunca o login/e-mail — que podem mudar de dono
([RN-276](../business-rules.md#rn-276)). `user_id` é `NOT NULL`: o vínculo
nasce no MESMO passo que resolve a identidade, sem um estado intermediário
"identidade sem dono".

### 5. As três decisões do callback, em ordem

`SocialLoginCallbackUseCase` decide, nesta ordem
([RN-272](../business-rules.md#rn-272)):

1. **Identidade já conhecida** (`(provider, providerUserId)` em
   `social_identities`) → login direto.
2. **Identidade nova, e-mail bate com conta existente E o provider marca o
   e-mail como VERIFICADO** → vincula e loga
   ([RN-274](../business-rules.md#rn-274)). Vincular é fusão de contas — a
   verificação do PROVIDER faz o papel que o clique no link de verificação
   faz no registro por senha, e por isso, como efeito colateral, uma conta
   registrada por senha e nunca verificada fica com `emailVerifiedAt`
   preenchido depois de vincular ([RN-279](../business-rules.md#rn-279)):
   o provider acabou de provar, por um caminho independente, exatamente o
   que aquele clique provaria.
3. **Identidade nova, e-mail bate mas NÃO verificado** → recusa
   (`403`). Um e-mail digitado (não verificado) num provider OAuth não é
   prova de posse — aceitar aqui seria abrir account takeover: quem tem
   `alguem@empresa.com` na Brabo não pediu para um GitHub alheio, com aquele
   endereço só digitado, herdar a conta.
4. **Identidade nova, sem conta correspondente** → provisiona usuário NOVO,
   **sem senha** — reusando o MESMO estado "pendente" que a migração do
   Keycloak já deixa (`users` sem linha em `auth_credentials`,
   [RN-278](../business-rules.md#rn-278)). Aqui o e-mail NÃO precisa estar
   verificado ([RN-275](../business-rules.md#rn-275)): não há conta
   existente para tomar, só uma para nascer, e exigir verificação
   encareceria o caso comum sem proteger nada. `LoginUseCase` e
   `ResetPasswordUseCase` já sabem tratar esse estado — a conta social ganha
   "esqueci minha senha" de graça, sem um segundo mecanismo.

### 6. O callback nunca expõe token na URL nem no corpo

`GET /auth/oauth/:provider/callback` grava os cookies de sessão
(`definirCookiesDeSessao`, a MESMA função do login por senha) e redireciona
para `WEB_ORIGIN/`. O `access token` não viaja na URL: o boot da web
(`restaurarSessao()`, chamado em TODA carga de página, `apps/web/src/main.tsx`)
já troca o refresh recém-gravado por um access token — zero código novo do
lado do cliente além dos dois botões e o alias de rota de erro
([RN-282](../business-rules.md#rn-282)). Falha vai para
`WEB_ORIGIN/login?oauth_error=1`, sem detalhar o motivo — mesmo padrão do
callback de conexão de git ([RN-283](../business-rules.md#rn-283)).

### 7. Reuso do MESMO app OAuth — sem variável de ambiente nova

`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` e `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`
continuam sendo os do app já cadastrado para conexão de git. O que muda por
fluxo é o `redirect_uri` (`/auth/oauth/<provider>/callback` em vez de
`/git/oauth/<provider>/callback`) e o `scope` pedido — ambos decididos em
tempo de requisição, não de configuração
([RN-281](../business-rules.md#rn-281)). **Ação do operador continua
necessária**: o segundo callback URL precisa ser cadastrado no app OAuth de
cada provider (documentado em `.env.example`) — é essa exigência, não uma
env var nova, que justifica o branch nascer `breaking/`.

## Consequências

- **Duas rotas públicas novas** (`GET /auth/oauth/:provider/start`,
  `GET /auth/oauth/:provider/callback`), justificadas em
  `docs/security-surface.md` e cobertas por `route-surface.spec.ts` — a
  superfície pública passa de doze para catorze rotas.
- **`social_identities` é tabela NOVA**, sem soft delete e sem histórico:
  desvincular uma identidade (revogar acesso por GitHub/GitLab mantendo a
  conta) não tem UI nem rota nesta frente — backlog.
- **Só GitHub e GitLab.** Nenhum provider OIDC genérico, nenhuma federação
  SAML — o backlog dos ADRs 0031/0032 continua valendo para **MFA**,
  **federação OIDC genérica** e **a api como provedor OIDC**. O que este ADR
  revisa é SÓ o item "login social" daquela lista, e só para os dois
  providers que já têm `GitOauthClient` registrado.
- **`emailVerified` depende do provider dizer a verdade.** O GitHub separa
  e-mail de verificação em duas chamadas (`/user` e `/user/emails`); o
  GitLab embute a verificação em `confirmed_at` da CONTA. Os dois são
  tratados como equivalentes por decisão de produto — nenhum dos dois é
  auditável pelo lado da Brabo além de confiar na resposta do provider.
- **Conta social-only nunca passa pelo balde de lockout do login por
  senha** (RN-030/031): não há tentativa de senha para conter. O que a
  contém é o próprio handshake OAuth, do lado do provider.
- **`CLAUDE.md` precisa perder a frase "Não implementar (…) login social"**
  da seção "O que NÃO fazer" — não editado por este ADR (fica para a PR de
  fechamento da onda, junto das outras frentes).
