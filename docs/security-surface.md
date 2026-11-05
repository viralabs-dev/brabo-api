# Superfície exposta da api

Toda rota registrada, com a classificação de autenticação e a
justificativa das que ficam abertas. Decisões no
[ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Este documento é a fonte de verdade de um teste**, não a cópia de um.
> `apps/api/test/interfaces/route-surface.spec.ts` sobe a aplicação,
> enumera as rotas **registradas em runtime** e as compara com a tabela
> abaixo. Rota nova sem linha aqui **reprova o teste**; linha cuja
> classificação difere da anotação real **reprova o teste**; linha órfã
> (que não casa com rota nenhuma) **reprova o teste**. A documentação não
> fica velha em silêncio.

## Classificações {#classifications}

| valor | o que significa |
|---|---|
| `public` | `@Public()` — sem token. Cada uma justificada abaixo |
| `engine-service` | `EngineServiceGuard`: `X-Brabo-Service-Token` igual ao segredo compartilhado. É a superfície interna api↔engine, fora do JWT |
| `role:<role>` | autenticada e restrita pelo RBAC do domínio (`@RequireRole`) |
| `jwt` | autenticada, sem papel exigido na rota — o escopo vem do próprio recurso |

## As quinze rotas públicas {#the-fifteen-public-routes}

Eram quatro até a Fase 6. A Fase 7a acrescentou oito de uma vez — auth
first-party —, o ADR 0084 mais duas, o login social, e a onda da chave de
dispositivo do runner acrescentou o proxy do binário. Cada uma é
justificada abaixo. Abrir mais alguma continua exigindo mexer na asserção
de `route-surface.spec.ts`, que lista as públicas literalmente para forçar
a conversa.

### Infraestrutura {#infrastructure}

**`GET /live`** — liveness. Não toca o banco de propósito: responde
enquanto o processo estiver vivo. Exigir token aqui faria o kubelet
reiniciar o pod no primeiro soluço do caminho de auth, transformando uma
degradação em queda total.

**`GET /health`** — readiness, com `select 1`. Mesmo raciocínio: quem
chama é o kubelet, e ele não leva token. Revela só se o banco responde.

**`GET /metrics`** — scrape do Prometheus, que também não leva token
nenhum. Exposição controlada pela REDE, não por auth: a NetworkPolicy só a
abre para o namespace `monitoring`, e o Ingress de produção bloqueia o
caminho. Sem `@Public()` o alvo apareceria `down` com todo o resto verde.

**`GET /git/oauth/:provider/callback`** — o retorno do OAuth do
GitHub/GitLab. O navegador do usuário chega aqui vindo do provedor, sem
sessão da api. Mas não é irrestrita: o parâmetro `state` é validado por
HMAC (`GIT_OAUTH_STATE_SECRET`), e sem `state` válido a chamada é recusada.

Essa garantia vale exatamente o que vale a chave, e é por isso que ela
deixou de ter default: em produção a api **recusa subir** com a chave de
exemplo do repositório, que é pública (ADR 0059,
[RN-093](business-rules/api.md#rn-093)). Com chave conhecida, esta rota
volta a ser irrestrita na prática — qualquer um assina um `state` para o
projeto que quiser.

**`GET /runner-releases/binary`** — faz proxy do binário standalone do
runner a partir das GitHub Releases, para o navegador nunca falar com o
GitHub direto. Pública pelo mesmo motivo de `/metrics`/JWKS: o binário em
si não é segredo, e exigir sessão para baixar a própria ferramenta que
permite alguém se autenticar seria às avessas. `platform` é uma lista
fechada de permitidos (`linux-x64`/`linux-arm64`/`darwin-arm64` — os três
alvos que a matriz de release constrói; `darwin-x64` saiu no
[ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) e `win32-x64` no
[ADR 0187](adr/0187-runner-sem-binario-win32-x64.md), e os dois são recusados com
mensagem própria apontando para o pacote npm), nunca interpolada crua na URL do GitHub — fechando o
vetor de SSRF/injeção de caminho que um parâmetro aberto deixaria. A URL
resolvida do asset (nunca os bytes do binário) fica em cache na memória
por alguns minutos, só para ficar abaixo do rate limit não autenticado do
GitHub sob downloads concorrentes; desde a sessão 3 da FASE 29 o
`checksums.txt` parseado — umas centenas de bytes de *texto* — é memoizado
na mesma entrada, então hash e binário vêm sempre da mesma release.

Desde a [RN-525](business-rules/produto.md#rn-525) ([ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md))
a rota não transmite mais bytes não verificados: ela confere o sha256 do
que baixou contra o `checksums.txt` da release e responde **502 com
`motivo` nomeado** quando não consegue — inclusive quando a release não
publica manifesto nenhum, que é *recusa*, nunca bytes servidos com aviso.
Leia a garantia de forma estreita: é **integridade contra o manifesto,
não procedência**. A rota **não** verifica a assinatura `cosign` do
manifesto (`checksums.txt.bundle`), então quem consegue reescrever a
Release reescreve os dois arquivos e passa. As duas formas de fechar isso
foram medidas e recusadas por ora — `cosign` na imagem são 155 MB, e
`@sigstore/verify` faria uma rota `@Public()` depender de um segundo host
de terceiro (`tuf-repo-cdn.sigstore.dev`) para conferir algo que nenhuma
Release ainda carrega. O consumidor que *verifica* a assinatura é o
`install.sh`. Como verificar o hash significa ler todos os bytes, o
download vai para um arquivo temporário sob `/tmp` (o `emptyDir` do pod,
montado porque o rootfs é somente leitura) com teto de 256 MiB, e só é
devolvido depois de o hash bater — nunca bufferizado no processo de 512Mi.

### Auth first-party {#first-party-auth}

As sete rotas `/auth/*` mais o JWKS. **Todas precisam ser públicas pelo
mesmo motivo estrutural:** são o caminho pelo qual um access token é
OBTIDO, e o `JwtAuthGuard` global exige um. Uma rota de auth atrás do
guard pediria a credencial que ela mesma emite. `logout` é a única que
poderia ser autenticada, e não é, de propósito: ela já carrega a
credencial que importa — o refresh no cookie, com o par de CSRF — e sair
precisa funcionar mesmo com o access token expirado.

> **O que protege estas rotas não é o rate limit.** O `RateLimitGuard`
> isenta as rotas `@Public()` — de propósito, para não estrangular o
> `/health` até o kubelet reiniciar o pod. O que segura esta superfície é
> o **bloqueio progressivo** por email e por IP, dentro dos casos de uso.
> Não é reforço opcional: é a única defesa que existe aqui.
> Ver
> [RN-030](business-rules/api.md#rn-030) e [RN-031](business-rules/api.md#rn-031).

**`POST /auth/register`** — cadastro. Responde `202` tanto para endereço
novo quanto para já cadastrado; no segundo caso nada é criado e o dono do
endereço recebe um aviso. Um `409 Conflict`, que é o que o bom senso REST
pediria, entregaria a lista de usuários a qualquer um com uma wordlist.

**`POST /auth/login`** — autenticação. Email inexistente, senha errada e
conta bloqueada devolvem todos a **mesma** resposta 401, e levam o
**mesmo** tempo (o ramo sem conta confere contra um hash fictício com
parâmetros idênticos).

**`POST /auth/refresh`** — rotação. O próprio refresh token é a
credencial, então a rota não pode exigir outra.

**`POST /auth/logout`** — revoga a família do token apresentado. Sempre
`204`, mesmo para token desconhecido: responder 401 aqui seria um oráculo
de validade de token.

**`POST /auth/verify-email`**, **`POST /auth/request-password-reset`**,
**`POST /auth/reset-password`** — fluxos de conta. Quem chega nelas ainda
não tem sessão, por definição. A credencial é o token de uso único que
veio por email; link inválido, expirado ou já usado recebem resposta
idêntica.

**`GET /.well-known/jwks.json`** — a metade **pública** do par Ed25519
que assina os access tokens. Mesmo raciocínio de `/metrics`: o consumidor
não tem token, e exigir um seria pedir credencial para validar credencial.
Publicar a chave pública é todo o propósito do formato — o que nunca pode
sair daqui é o componente `d` da JWK, travado por teste.

### Login social (ADR 0084) {#social-login-adr-0084}

**`GET /auth/oauth/:provider/start`** — redireciona direto para o
provedor (GitHub/GitLab). Pública pelo mesmo motivo estrutural das outras
sete: é o próprio ponto de entrada, antes de existir sessão. O `state` que
ela gera é assinado por HMAC com propósito PRÓPRIO
(`signSocialOauthState`/[RN-273](business-rules/api.md#rn-273)) — nunca o
mesmo `state` do `GET /git/oauth/:provider/callback` acima, embora as duas
rotas assinem com a MESMA chave `GIT_OAUTH_STATE_SECRET`. O campo
`purpose` no payload é o que impede um `state` de um fluxo de ser aceito
pelo verificador do outro.

**`GET /auth/oauth/:provider/callback`** — recebe o retorno do provedor.
Mesmo raciocínio do callback da conexão de git: o navegador chega sem
sessão, o `state` é verificado por HMAC, e a rota nunca devolve JSON — ela
sempre redireciona, para `WEB_ORIGIN/` no sucesso (com os cookies de
sessão já gravados) e para `WEB_ORIGIN/login?oauth_error=1` na falha, sem
detalhar o motivo na URL.

## Notas {#notes}

- **Anexos do chat: SEM antivírus, lacuna declarada**
  ([ADR 0246](adr/0246-anexos-do-chat-bytes-no-postgres-referencia-no-evento.md),
  [RN-986](business-rules/api.md#rn-986)/[RN-988](business-rules/api.md#rn-988)).
  `POST .../attachments` (`developer`) confere o tipo pelos bytes e os tetos
  (5 MB imagem, 512 KB texto), mas não varre o conteúdo. Os bytes nunca
  executam: ficam num `bytea`, nunca em disco nem no worktree, e saem em
  `GET .../attachments/:id` (`viewer` — todo membro do projeto lê) com
  `Content-Type` gravado, `nosniff` e `attachment` para o que não é imagem.
  Não há ClamAV; instalar um é decisão do dono.
- **`POST /workspaces/:workspaceId/projects` decide onde o agente vai
  escrever, e é por isso que é uma rota de superfície de segurança, não só
  de cadastro**
  ([ADR 0072](adr/0072-projeto-local-ou-container.md)/
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
  [RN-169](business-rules/api.md#rn-169)/[RN-421](business-rules/api.md#rn-421)/
  [RN-422](business-rules/api.md#rn-422)). O corpo ganhou `executionMode`
  (`container` — o padrão e o comportamento de sempre —, `mounted`, o
  antigo `local`, renomeado, ou `runner`) e `workspacePath`. Em `mounted`/
  `runner` o caminho absoluto informado vira a **raiz do escopo do
  terminal** do ADR 0055: o que se digita aqui é o que o agente pode ler e
  escrever. Nenhuma rota nova, e nenhuma mudança de papel
  (`RequireRole('maintainer')`, como já era) — o que mudou é o alcance do
  que a rota concede.

  Desde o [ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md)
  ([RN-501](business-rules/api.md#rn-501)) os DOIS modos que não são
  `container` validam a MESMA coisa na criação: só a forma LÉXICA —
  absoluto, sem `..`, nunca a raiz nem uma pasta de sistema, nunca
  sobreposto ao checkout do Brabo em nenhum dos sentidos (RN-422/RN-423) —
  sem I/O de disco nenhum. `mounted` acrescenta uma regra própria: o
  caminho tem de estar dentro de `BRABO_PROJECTS_BASE`, a única pasta da
  máquina que os dois containers enxergam (ADR 0141), e sem base
  configurada a recusa diz que o MODO não está disponível nesta instalação
  em vez de culpar o caminho.

  **A parte relevante para a segurança dessa mudança é o que NÃO se
  moveu.** O caminho informado continua sendo a raiz do escopo do terminal,
  e o predicado léxico continua sendo o que o contém — ele roda em toda
  derivação da raiz, nas LEITURAS também, porque escrever direto no banco é
  a única forma de contornar a criação. O que foi adiado é a checagem de
  DISCO (existe? é diretório? este processo consegue escrever nele?), que
  nunca conteve nada: ela respondia "isto vai funcionar", não "isto é
  permitido". Ela roda agora em `materializarWorkspaceMontado`, quando a
  Infra sobe o container (e, como exceção declarada, na conversão de modo),
  e a regra da base é reaplicada ali ANTES do `mkdir -p` — então um caminho
  escrito fora do produto não faz a api criar pasta em qualquer lugar que
  ela alcance.

  A regra da base fica FORA do predicado léxico de propósito: aquele roda
  em toda leitura, e um projeto `mounted` LEGADO fora da base passaria a
  falhar só por ser lido. `runner` continua sendo confirmado pelo próprio
  runner, a única parte com autoridade sobre o host real (RN-423, ver
  `POST /internal/projects/:projectId/workspace-verification` abaixo);
  `mounted` passa a ser confirmado pela materialização, que carimba
  `workspace_verified_at` do mesmo jeito. O modo fica **congelado** depois:
  `UpdateProjectDto` omite os dois campos de propósito, senão
  `PartialType(CreateProjectDto)` os exporia num `PATCH` sem guarda
  nenhuma.
- **`GET /workspaces/:workspaceId/containers` agora lista TODO projeto do
  workspace, e a página que ele alimenta virou o caminho humano para SUBIR um
  container**
  ([RN-521](business-rules/api.md#rn-521),
  [ADR 0136](adr/0136-pagina-global-de-containers.md)). O papel não mudou
  (`viewer`, como já era) e o escopo também não: ela continua respondendo só
  pelos projetos do workspace que o chamador enxerga. O que mudou foi o
  conjunto de linhas — um projeto que nunca provisionou container ficava
  AUSENTE e agora aparece com `registrado: null`, um TERCEIRO estado que não é
  `stopped` nem "não foi possível observar". A leitura continua limitada do
  mesmo jeito: três consultas em lote qualquer que seja o número de projetos, e
  no máximo `TETO_DE_VERIFICACOES_POR_CARGA` (20) chamadas ao broker por carga,
  com as linhas sem container nunca elegíveis e portanto nunca capazes de
  tirar a vez de uma real.

  **Nada nesta página age diretamente.** Parar, remover e subir são todos
  `proposed_action`, sempre com um HUMANO clicando, nunca um agente, e nenhum
  teto de `decide.ts` é tocado: os dois tipos de subida exigem `maintainer`, e
  `container_remove` fica no teto absoluto da família de comando privilegiado
  ([RN-418](business-rules/api.md#rn-418)) — nunca auto-aprovável, "sempre
  permitir" recusado na fonte. `container_recreate` (remove + sobe de novo, [RN-934](business-rules/api.md#rn-934)) entra no mesmo teto. A rede declarada (`PUT .../container/network`, `maintainer`, [RN-932](business-rules/api.md#rn-932)) só grava artefato — nada muda no Docker até a recriação aprovada. A tela ramifica a ação de subida por
  `execution_mode` exatamente como o backend
  ([RN-497](business-rules/produto.md#rn-497)/[RN-503](business-rules/api.md#rn-503)):
  `container`/`mounted` propõem `container_start` (broker) e `runner` propõe
  `container_start_via_runner` (agente local), com o payload que o schema de
  cada um de fato aceita.

  As recusas da própria tela são honestidade, não imposição: ela não oferece o
  botão sem imagem decidida (o portão da RN-105, válido nos TRÊS modos desde a
  [RN-494](business-rules/broker.md#rn-494)), nem para um projeto `runner` cuja pasta
  nenhum agente local jamais confirmou, nem para papel abaixo de `maintainer` —
  e diz qual dos três é, em texto. **Quem recusa de verdade continua sendo o
  `RolesGuard` e os casos de uso.** O papel lido aqui é o de WORKSPACE, não o
  papel efetivo do projeto (`projectRole ?? workspaceRole`,
  [RN-471](business-rules/web.md#rn-471)): um membro rebaixado dentro de um projeto
  ainda vê o botão e recebe 403, um custo declarado de não pagar um N+1 de
  `project_members` numa página que atravessa projetos.
- **`PUT /projects/:projectId/mirror-path` grava um caminho na máquina do
  USUÁRIO, e a api nunca vê essa máquina** ([RN-515](business-rules/api.md#rn-515),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), ponto 4). Ela guarda
  o destino para onde a capacidade `espelho` copia o trabalho do projeto — uma
  pasta FORA da base montada, que é justamente por que um bind mount não a
  alcança e um agente local precisa alcançar.

  O mínimo é `maintainer`, o mesmo de `execution-mode` e `projects-base`
  acima, e pelo mesmo motivo: esta rota trata de um caminho no próprio sistema
  de arquivos do operador, não de metadado de projeto.

  O que a api consegue validar aqui é SÓ a forma LÉXICA, e a mensagem de
  recusa diz isso. Ela reusa `caminhoDeWorkspaceLocalValido` — absoluto, sem
  `..`/`.`, nunca a raiz, nunca uma pasta de sistema, nunca sobreposto ao
  checkout do próprio Brabo — exatamente como a criação em `runner` faz
  ([RN-423](business-rules/runner.md#rn-423)), e pelo mesmo motivo: não há disco aqui
  a quem perguntar. Ela NÃO exige `BRABO_PROJECTS_BASE`, porque estar fora da
  base é o objetivo.

  Duas recusas são próprias desta rota. O destino não pode estar dentro de
  `workspacePath` nem contê-lo — o mesmo laço visto dos dois lados, já que
  gravar o espelho dentro da própria origem faz o espelho copiar a si mesmo —
  e a comparação é por SEGMENTO (`dentroDoEscopo`), então `/base-outra` não
  está dentro de `/base`. E um projeto em `execution_mode: container` não pode
  ter destino nenhum: a origem dele é um volume gerenciado NO SERVIDOR, e o
  processo que copiaria roda na máquina do USUÁRIO, que não o enxerga. As duas
  são **400**.

  A outra metade da guarda — resolver symlinks com `realpath`, para que um
  link em qualquer segmento do destino não aponte de volta para dentro da
  origem — é do RUNNER, na máquina onde os dois caminhos de fato existem.
  **Esta rota não estabelece essa garantia**; ela só descarta o laço ESCRITO.
  Limpar é `mirrorPath: null`, e a chave é obrigatória: omiti-la seria
  indistinguível de pedir para limpar, e limpar em silêncio é o defeito.
  Gravar o espelho nunca é `proposed_action` — é configuração que o usuário
  declarou, não um agente pedindo para agir.
- **`GET /projects/:projectId/mirror-state` é `viewer`, um degrau abaixo da
  rota que GRAVA o destino** ([RN-517](business-rules/api.md#rn-517),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), ponto 7). Ela devolve
  o que a última rodada do espelho fez: qual dos três estados vale agora
  (`never` | `synced` | `failed`), a última sincronização bem-sucedida com as
  contagens dela, o destino congelado daquela rodada e o último erro.

  A assimetria com `PUT .../mirror-path` (`maintainer`) é deliberada e é a
  regra da [RN-102](business-rules/api.md#rn-102) aplicada: o mínimo é do
  ENDPOINT, e este só LÊ. O próprio destino já vai em toda leitura do projeto
  (`GET /projects/:projectId`, `viewer`), então exigir `maintainer` aqui
  trancaria uma informação de quem já a vê no mesmo projeto — o pior dos dois
  defeitos, porque é invisível para quem perdeu a capacidade.

  Vale dizer o que ela NÃO expõe: nenhum nome de arquivo, nenhum conteúdo,
  nenhum caminho além do destino que o chamador já pode ler. As contagens são
  contagens.
- **`GET /workspaces/:workspaceId/projects-base` revela um pedaço da
  topologia do sistema de arquivos do operador, e é por isso que não é
  `viewer`**
  ([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
  [RN-500](business-rules/api.md#rn-500)). Ela devolve
  `{ projectsBase: string | null }` — a única pasta do host montada por
  identidade nos containers `api` e `engine`, sob a qual vive todo projeto
  `mounted`. `null` é o estado normal de uma instalação que não oferece o
  modo Montado, e é assim que o assistente de projeto aprende a não oferecer
  um modo que esta instalação não consegue honrar.

  O mínimo é `maintainer`: o **mesmo** de `POST
  /workspaces/:workspaceId/projects` acima, porque decidir o que aquela rota
  oferece é a única serventia deste valor. Herdar `viewer` das leituras
  vizinhas `projects-*` — elas ficam lado a lado no mesmo controller —
  entregaria um caminho absoluto do host a todo mundo que consegue olhar o
  workspace, sem capacidade nenhuma em troca. `workspaceId` não entra no
  cálculo: a base é configuração da **instalação**, idêntica para todo
  workspace, e o parâmetro está lá só para dar um escopo ao `RolesGuard`.

  Desde o [ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)
  ([RN-573](business-rules/api.md#rn-573)) a resposta também leva
  `brokerConfigurado: boolean` — se `BROKER_URL` está definido, lido por
  `ContainerBrokerPort.configurado()`. Ela revela um bit da topologia da
  instalação (existe ou não um broker com o socket do Docker), nunca o
  endereço dele, e o mínimo continua `maintainer`. O mesmo bit vai em toda
  linha de `GET /workspaces/:workspaceId/containers` (`viewer`,
  [RN-574](business-rules/api.md#rn-574)), um alargamento deliberado: aquela
  página precisa dizer ANTES do clique que `container`/`mounted` não sobem
  aqui, e quem consegue ver a página já podia inferir a ausência por
  `naoObservado: broker-nao-configurado` sempre que uma linha está
  `provisioning`/`running`. Ela diz que a variável existe, nunca que o broker
  responde.
- **`GET /workspaces/:workspaceId/project-folders` serve listagens de
  diretório a partir de um caminho informado pelo cliente, e toda a
  segurança dela é UMA contenção** ([RN-504](business-rules/web.md#rn-504),
  [ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)). Ela existe
  porque o assistente de projeto perdeu de uma vez os seus dois mecanismos
  de "procurar uma pasta": `FolderBrowserModal` navegava pelo websocket do
  RUNNER, e `RunnerOnboardingPanel` usava `showDirectoryPicker`, que devolve
  um handle do navegador e nunca um caminho absoluto. Com o runner saindo da
  criação de projeto, o navegador não tem como listar um sistema de arquivos
  — então a api lista, e a api só enxerga uma pasta: a base de projetos
  montados.

  A contenção é essa base e nada mais. `path` é opcional e o padrão é
  `BRABO_PROJECTS_BASE`; todo `path` informado tem de satisfazer
  `dentroDaBaseDeProjetos` — o mesmo `dentroDoEscopo` que o escopo do
  terminal do ADR 0055 usa, então `/home/you/brabo2` NÃO está dentro de
  `/home/you/brabo` mesmo com a string começando igual. Sair da base é
  **400**, não 403: 403 sugeriria que algum outro papel a veria, e nenhum vê.
  O pedido está malformado, não sub-autorizado. `..` e `.` são recusados de
  saída em vez de resolvidos, pelo mesmo motivo que o predicado da criação os
  recusa — resolver é aceitar que o caminho lido não é o caminho pedido.

  Os tetos fazem parte do contrato, não são detalhe de implementação: só
  diretórios, no máximo 500 (ordenados ANTES do corte), nunca recursivo,
  entradas com prefixo de ponto excluídas, e symlinks informados mas nunca
  percorridos — então um link apontando para fora da base não é uma saída
  dela. O que é excluído é CONTADO (`arquivos`, `simbolicos`, `truncado`),
  então uma pasta cheia de código nunca volta parecendo vazia
  ([RN-180](business-rules/web.md#rn-180)). Não há POST companheiro:
  criar pasta é da materialização do workspace montado, nunca do seletor.

  O mínimo é `maintainer`, o mesmo de `POST
  /workspaces/:workspaceId/projects` e `projects-base` acima, e pelo mesmo
  motivo levado um passo adiante: `projects-base` revela UM caminho na
  máquina do operador, esta rota revela a TOPOLOGIA abaixo dele. Quem não
  pode criar projeto não tem nada a fazer com a lista de pastas onde um
  projeto poderia ser criado.
- **`GET /`** é o "Hello World!" do scaffold do NestJS
  (`src/app.controller.ts`). Está atrás da guarda e não vaza nada, mas não
  serve para nada — candidata a remoção. Ficou registrada aqui em vez de
  removida, porque isso é decisão de produto, fora do escopo desta sessão.
- **`GET /internal/projects/:projectId/git-remote` é a única rota do produto
  que devolve um segredo DECIFRADO** — o token de git do owner do workspace
  ([ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
  Ela existe porque o engine trabalha no sistema de arquivos e não tem a
  chave mestra; replicá-la no engine dobraria o raio de impacto do segredo
  mais sensível do produto. Duas propriedades a mantêm defensável: o
  `origin` que ela devolve é **limpo** (a credencial vem num campo separado,
  nunca embutida na URL), e o consumidor é obrigado a injetá-la por
  invocação, nunca em arquivo — ver `Engine.Actions.GitAuth` e o raciocínio
  disso na [RN-076](business-rules/engine.md#rn-076). Se esta rota um dia
  passar a devolver a URL já autenticada, o token acabaria em `.git/config`,
  dentro da pasta onde o dev agent tem leituras auto-aprovadas.

  No modo `runner` essa injeção por invocação viaja um salto a mais — o
  campo `env` da mensagem `exec` ([RN-507](business-rules/runner.md#rn-507)) — e
  ela para na fronteira do container: a porta de Docker do produto **não tem
  campo `env`**, de propósito ([ADR 0130](adr/0130-broker-de-container.md)),
  então um comando roteado para dentro do container por `docker exec` nunca
  consegue levar o token. Essa contenção se manteve; o que não se manteve foi
  o relato. Até a [RN-558](business-rules/runner.md#rn-558) o runner rodava esse
  comando **mesmo assim**, com o credential helper instalado e as variáveis
  vazias, e a falha de autenticação resultante era indistinguível de um token
  ruim ou de uma rede quebrada — no caminho *comum*, já que o container
  `running` registrado que a RN-507 exige só existe porque esse mesmo runner o
  subiu. O runner agora **recusa** o par (credencial presente, container
  ativo) antes de executar qualquer coisa, e o engine classifica a recusa com
  origem `politica` em vez de `codigo`. O texto da recusa não nomeia as
  variáveis nem os valores delas, só quantas eram. A credencial continua sem
  atravessar a fronteira do container, e desde o
  [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
  ([RN-676](business-rules/runner.md#rn-676)) ela não precisa: o engine marca o
  `fetch` autenticado (`gitCredenciado: true`, posto de um lugar só,
  `RunnerRouter.exec_git_credenciado/5`) e o runner roda ESSE comando no
  host, onde o `env` chega ao processo filho; os comandos do dev agent
  continuam indo para `docker exec`. A fronteira de confiança é a marca, não
  o `env`: um comando levando `env` SEM a marca continua recusado enquanto há
  container ativo, então o campo de credencial nunca vira uma saída do
  container. Nenhuma porta do ADR 0130 mudou.
- **As três rotas de leitura do PO** — `GET /internal/projects/:projectId/business-rules`,
  `GET /internal/projects/:projectId/backlog` ([RN-164](business-rules/engine.md#rn-164))
  e `GET /internal/projects/:projectId/product-metrics` ([RN-407](business-rules/contracts.md#rn-407)) —
  não devolvem segredo nenhum e **não aceitam nada além do id do projeto**:
  nenhum termo de busca, nenhuma paginação, nenhum filtro. É de propósito.
  Uma rota de leitura para agente é uma superfície que o modelo escolhe
  chamar, e um parâmetro é onde o modelo escreve o que quiser; aqui não há
  onde escrever. O escopo é fechado ao projeto pelo caminho, e o custo por
  chamada é constante (três leituras no backlog, duas nas regras, uma
  consulta a `proposed_actions` filtrada por índice nas métricas de
  produto).
- **A leitura de contratos do dev agent** — `GET /internal/projects/:projectId/module-contracts`
  ([RN-684](business-rules/api.md#rn-684), [ADR 0200](adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md))
  — segue a mesma regra: nenhum segredo, nada além do id do projeto, uma
  entrada por módulo do `module_map` vigente. A gêmea de escrita,
  `POST /internal/sessions/:sessionId/module-contracts`, recebe só a
  declaração do Arquiteto (o que cada módulo expõe) e valida todo nome
  contra o `module_map` vigente; nenhuma das duas rotas toca um worktree.
- **`POST /internal/projects/:projectId/workspace-verification`** (RN-423,
  ADR 0104) é chamada só pelo engine, depois que um runner conecta e manda
  `workspace_confirm` pelo canal — nunca diretamente pelo runner, que não
  tem o service token. O runner é a FONTE DE VERDADE do caminho (ele
  SOBRESCREVE `workspacePath`, sem exigir que bata com o que foi digitado na
  criação), mas o caminho informado ainda passa pela MESMA checagem léxica
  da criação (`caminhoDeWorkspaceLocalValido`) — raiz do sistema e
  sobreposição com o checkout do Brabo continuam proibidas mesmo vindo do
  runner. `400` se o projeto não estiver no modo `runner`.

  Desde o [ADR 0151](adr/0151-base-consentida-no-runner.md)
  ([RN-529](business-rules/runner.md#rn-529)) o runner pode TAMBÉM nascer com uma
  **base** — uma pasta daquela máquina sob a qual cada projeto é uma
  subpasta. Duas coisas sobre ela cabem nesta página. Primeiro, a base é
  **local e nunca chega pela rede**: vem de `--base` ou de
  `$XDG_CONFIG_HOME/brabo/runner.json`, nunca de um campo do servidor, então
  o invariante do [ADR 0130](adr/0130-broker-de-container.md)/
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) vale deste lado também —
  quem é dono da raiz é quem executa, e só o **segmento relativo** viaja.
  `resolverPastaDoProjetoNaBase` recusa um segmento ABSOLUTO lexicamente em
  vez de reinterpretá-lo. Segundo, a base **não** entra na validação de
  `--dir`, exatamente como a regra da base fica fora do predicado léxico da
  api: um projeto cuja pasta é anterior à base continua funcionando. A guarda
  é uma TERCEIRA irmã de `guard.ts`, reusando
  `dentroDoEscopo`/`realpathMaisProximo`/`semBarraFinal` e a mesma passada
  dupla léxica-depois-`realpath` — e herda por escrito a mesma ressalva de
  TOCTOU: melhor esforço, nunca a fronteira de segurança.

  Desde a [RN-532](business-rules/runner.md#rn-532) (mesmo ADR, pontos 3 a 6) essa
  base tem um CONSUMIDOR: o par `workspace_create`/`workspace_create_result`.
  Três coisas sobre ele cabem nesta página. Primeiro, **nenhuma rota de
  escrita nova nasceu**: tendo criado a pasta, o runner empurra o
  `workspace_confirm` que já existia, e é ele — por este mesmo endpoint — que
  carimba `workspace_verified_at`. O engine continua sem escrever a tabela, e
  o caminho único que carimba continua único. Segundo, o que viaja é o
  **segmento relativo**, nunca um caminho absoluto, e o runner recusa um
  absoluto lexicamente. Terceiro, a capacidade `workspace` é a única das
  quatro cuja declaração depende do ESTADO do runner e não da versão dele —
  ela só é declarada quando uma base foi consentida —, então é por essa
  declaração, e por nada mais, que o servidor fica sabendo que existe uma
  base. Ninguém a EXIGE no join: um runner sem base conecta e atende o
  projeto dele como sempre, e só `workspace_create` é recusado, com uma
  resposta NOMEADA. Criar essa pasta é configuração consentida, não um agente
  pedindo para agir: **não** é `proposed_action`, e nenhum teto de
  `decide.ts` ganha exceção.
- **`POST /internal/projects/:projectId/container-exec`** ([RN-492](business-rules/engine.md#rn-492),
  [ADR 0134](adr/0134-dev-agents-executam-dentro-do-container.md)) é chamada
  só pelo engine, quando `Engine.Actions.TerminalExecutor` decidiu que um
  comando de terminal pertence ao container real do projeto. Ela repassa a
  `ContainerBrokerPort.exec` — a api nunca roda o comando ela mesma.
  Diferente de `container-spec` abaixo, aqui é o ENGINE chamando a api, não o
  broker; o corpo da resposta nunca lança por recusa do broker nem por broker
  inalcançável (`{ sucesso: false, motivo }` é a forma normal, pela RN-486 —
  uma linha `running` nunca garante que o container está de pé agora), então
  um container morto é um comando falho comum, não um 5xx.
- **`POST /internal/projects/:projectId/mirror-sync-result`** ([RN-517](business-rules/api.md#rn-517),
  [ADR 0147](adr/0147-agente-local-com-capacidades.md), ponto 7) é chamada
  só pelo engine, depois que o runner empurra `mirror_sync_result` pelo
  canal — nunca diretamente pelo runner, que não tem o service token. A mesma
  forma e o mesmo caminho de `workspace-verification` acima, e pelo mesmo
  motivo: o runner é a única parte que sabe o que aconteceu na máquina do
  usuário, e o engine repassa em vez de escrever a tabela ele mesmo.

  Ela grava TELEMETRIA e nada mais: uma linha em `project_mirror_states`,
  nunca o event log (uma rodada de espelho não tem sessão e
  `session_events.session_id` é `NOT NULL`) e nunca um `proposed_action`.
  O corpo leva um desfecho, três contagens e uma mensagem de erro — nenhum
  caminho sobre o qual a api aja, nada executado, nada concedido. Gravar
  nunca derruba o que mede: a cópia já terminou quando isto é chamado, e uma
  recusa aqui só é registrada em log pelo engine.
- **`POST /internal/projects/:projectId/qa-environments/:taskId/start`**,
  **`POST /internal/projects/:projectId/qa-environments/:taskId/remove`** e
  **`POST /internal/qa-environments/sweep`** ([RN-935](business-rules/api.md#rn-935),
  [ADR 0229](adr/0229-instancia-de-qa-efemera-com-servicos-declarados-pela-infra.md)) são chamadas só
  pelo engine (`engine-service`, `BRABO_SERVICE_TOKEN`). A api chama o broker e
  grava `project_qa_environments`; o corpo do `sweep` é só a lista de ids de
  tarefa em voo, e a remoção só alcança o que o broker rotula `brabo.papel=qa`.
  O `alvo` de QA do `container-exec` vem do engine, nunca do modelo. Desde a
  [RN-941](business-rules/contracts.md#rn-941) o serviço de QA leva `user` (`<uid>:<gid>`,
  nunca 0) e `command` (argumentos depois da imagem, sem quebra de linha) no
  `qa` do `container-spec`, os dois validados pela api e de novo pelo broker
  antes de virar `docker run`.
- **`GET /internal/projects/:projectId/container-spec`** ([ADR 0130](adr/0130-broker-de-container.md),
  [RN-485](business-rules/produto.md#rn-485)) é a única rota `engine-service` cujo
  chamador NÃO é o engine — é o **broker** de containers, o único processo do
  produto com acesso a um daemon Docker. A classificação nomeia o MECANISMO
  (`BRABO_SERVICE_TOKEN` no cabeçalho próprio, comparado em tempo constante),
  não o remetente, e o segredo é o mesmo de propósito: os três serviços rodam
  no mesmo cluster e leem o mesmo Secret, então um segundo segredo daria a
  impressão de compartimentar sem compartimentar nada (o raciocínio completo
  está em `service-token.ts`). O que faz a rota valer a existência é a direção
  da chamada: o broker não RECEBE uma spec de container, ele vem aqui LER a
  identidade do projeto, o modo de execução e a decisão de imagem vigente do
  Arquiteto, e compõe a spec ele mesmo. Uma spec viajando num corpo de
  requisição faria a contenção de um processo equivalente a root depender de o
  chamador estar certo. Ela **não devolve caminho absoluto nenhum** — a origem
  do bind é resolvida pelo daemon contra o sistema de arquivos do HOST, então um
  caminho de dentro do container da api montaria em silêncio uma pasta vazia.
  O que viaja no lugar é `localizacao`
  ([RN-503](business-rules/api.md#rn-503),
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)): um localizador
  discriminado dizendo qual das DUAS raízes do broker resolve a pasta
  (`gerenciada` → `PROJECT_WORKSPACES_HOST_ROOT`, `montada` →
  `BRABO_PROJECTS_HOST_BASE`, ou `indisponivel` com um motivo) mais o segmento
  RELATIVO que essa raiz não cobre. A api nunca fica sabendo onde essas raízes
  estão no host, e o broker nunca fica sabendo nada do projeto — nenhum dos
  lados sozinho consegue escrever um caminho arbitrário, e essa é a contenção.
  O broker recusa o `start` nomeando a raiz que falta, nunca caindo na outra,
  e revalida o segmento (`..`, absoluto, vazio, `NUL`, todos recusados) mais o
  resultado concatenado antes de ele virar um `-v`. Ele também descarta
  `rationale`, que existe para um humano revisar a decisão e não tem
  consumidor num `docker run`.
- **`GET /internal/projects/:projectId/container-spec` ganhou
  `usuarioDaPasta`, e a classificação não mudou** — continua
  `engine-service`, continua chamada só pelo broker ([ADR 0180](adr/0180-container-com-o-dono-da-pasta.md),
  [RN-627](business-rules/contracts.md#rn-627)). O campo é o `{ uid, gid }` da pasta do
  projeto como a api a vê pelo `stat`, ou `null` (modo runner, pasta
  inalcançável, pasta de root). O broker o revalida (inteiros em
  1..2^31-1; `0` é recusado pelo nome) e o usa como `--user`; ele nunca lê um
  usuário de corpo de requisição, então continua não havendo campo em que um
  chamador escreva `privileged`, `cap_add` ou uma montagem. Ele roda o
  container com MENOS poder que antes (non-root em vez de root), com
  `--cap-drop ALL` intacto.
- **`POST /projects/:projectId/runner-ticket` é classificada `role:developer`
  como qualquer outra rota, mas NÃO aceita JWT de sessão** (ADR 0105,
  RN-424) — só um Personal Access Token (`brb_…`) OU uma chave de
  dispositivo do runner (Ed25519, ver abaixo). A classificação automática
  (`route-surface.spec.ts`) não distingue os mecanismos, porque a EXIGÊNCIA
  de papel é a mesma; o que muda é só como `request.user` é estabelecido.
  `PatAuthGuard` roda no lugar de `JwtAuthGuard` nesta rota
  (`@RequirePatAuth()`, o mesmo padrão estrutural de
  `@ServiceRoute()`/`EngineServiceGuard` — desvio por metadado, nunca um `if`
  que uma rota nova possa esquecer), e é o ÚNICO lugar da api que aceita
  qualquer um desses formatos de credencial: em qualquer outra rota um
  `brb_...` falha na verificação de JWT normalmente, e um JWT de chave de
  dispositivo também (o `kid` dele nunca resolve contra as chaves do próprio
  emissor de tokens de sessão). As cinco rotas sob
  `/projects/:projectId/personal-access-tokens` (emitir/listar/revogar o
  próprio PAT, mais as duas de `maintainer` — RN-427, listar/revogar de
  QUALQUER usuário do projeto) continuam JWT de sessão comum — só a rota que
  o PRÓPRIO TOKEN autentica muda de mecanismo.
- **`GET /runner/projects` é classificada `jwt` e NÃO aceita JWT de sessão
  nenhum** ([RN-543](business-rules/produto.md#rn-543),
  [ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)). É a rota pela qual
  um agente de MÁQUINA descobre os projetos que atende, e é a primeira rota
  `@RequirePatAuth()` sem `:projectId` no caminho — que é exatamente o que ela
  existe para resolver: quem chama ainda não sabe quais projetos existem. Duas
  consequências, ambas fixadas por teste:
  - **Só uma credencial de MÁQUINA entra** (`runner_device_keys.project_id`
    NULL). Uma credencial amarrada a um projeto — um PAT, ou uma chave de
    dispositivo do fluxo do ADR 0118 — descreve um projeto e não tem o que
    descobrir; o `PatAuthGuard` a recusa com 403 e uma mensagem PRÓPRIA, nunca a
    de "projeto errado", que mentiria sobre o motivo. A comparação que recusa
    chave-de-A-em-B NÃO foi removida: ela some só para `null`, e os dois
    sentidos estão fixados.
  - **Não há `@RequireRole`, porque não há projeto contra o qual resolver um
    papel.** O mínimo `developer` — o MESMO do `runner-ticket` — é aplicado POR
    LINHA dentro de `ListRunnerProjectsUseCase`, com a régua única do produto
    (`ResolveEffectiveRoleUseCase.forProject`). Nada é afrouxado: o que sai é
    exatamente o conjunto de projetos para os quais o `runner-ticket` já
    autorizaria este usuário. O classificador automático lê `@RequireRole` e não
    vê mecanismo, então cai em `jwt` — a mesma aproximação que este documento já
    corrige em prosa para o `runner-ticket` acima. A rota nunca toca um JWT de
    sessão: o `JwtAuthGuard` se abstém nas rotas `@RequirePatAuth()`, e a chave
    pública que o `PatAuthGuard` verifica vem de `runner_device_keys`, nunca do
    emissor de sessão.

- **`POST /runner/llm-credentials` é classificada `jwt` e só aceita chave de
  dispositivo de MÁQUINA** ([RN-927](business-rules/api.md#rn-927),
  [ADR 0230](adr/0230-importar-chave-de-llm-pelo-runner.md)). É a PRIMEIRA rota
  em que uma credencial de máquina ESCREVE segredo de usuário: o
  `brabo-runner credentials import` grava a chave de API de LLM que a pessoa
  escolheu importar, pelo mesmo upsert com envelope do cadastro pela tela. Como
  `GET /runner/projects`, não tem `:projectId`, e o `PatAuthGuard` recusa com 403
  toda credencial amarrada a projeto; todo PAT é de projeto, então na prática
  PAT não chama esta rota (o guard não distingue "PAT de conta" porque ele não
  existe). Credencial existente exige `substituir: true` (409
  `credencial_existente`), e o valor nunca vai a log, evento nem resposta (o
  pino já redige `*.apiKey`; a auditoria leva provider e `origem`). O teto é a
  revogação da chave de máquina.

  Ela devolve o id do projeto, o nome, o `workspaceDirName` e o estado de
  verificação — nunca um caminho absoluto. O que atravessa o fio é o SEGMENTO,
  e a raiz é de quem executa, o mesmo invariante do broker (ADR 0144) e da base
  do runner (ADR 0151).

  Desde a [RN-544](business-rules/runner.md#rn-544) a rota tem o seu CONSUMIDOR:
  rodado sem `--project`, o `brabo-runner` a chama no início e abre **uma
  conexão por projeto listado** — e, desde a
  [RN-550](business-rules/runner.md#rn-550), quando essa lista volta **vazia** ele
  continua chamando, numa cadência declarada (15s, 30s, depois 60s repetindo),
  até o primeiro projeto aparecer. Essa espera tem teto do lado da falha, não
  do lado da espera: dez chamadas seguidas com falha e o processo sai com 1
  nomeando a contagem, qualquer resposta (vazia inclusive) zera o contador, e
  no momento em que uma conexão está viva a espera **para** — com conexão viva
  a lista continua lida só no início, pelo motivo abaixo. Cada conexão tem raiz
  em
  `<base>/<workspaceDirName>` pelas mesmas guardas
  (`resolverPastaDoProjetoNaBase`, depois RN-434/RN-435). Três coisas sobre
  isso pertencem a esta página. Primeiro, **nada no engine mudou**: o tópico
  `terminal:<projectId>`, o id do socket e o ticket descrevem uma CONEXÃO, e N
  conexões os satisfazem byte a byte — a recusa de um segundo runner no mesmo
  projeto não foi tocada, nem o espelho
  ([RN-516](business-rules/runner.md#rn-516)) e o `workspace_create`
  ([RN-532](business-rules/runner.md#rn-532)), que já viajavam na concessão do join
  DAQUELA conexão. Segundo, o JWT de descoberta **não leva claim
  `projectId`** — a guarda compara `payload.projectId !==
  request.params.projectId`, e numa rota sem projeto no caminho os dois têm de
  ser `undefined`; assinar ali um id de projeto inventado seria recusado com um
  403 que diz a coisa errada. Terceiro, **o runner nunca adivinha a espécie da
  própria chave**: em disco uma chave de máquina e uma de projeto são o mesmo
  arquivo (uma JWK privada com `kid`), quem sabe é o servidor, e o 403 nomeado
  é repassado com a própria mensagem e a própria correção (`--project`) em vez
  de achatado numa falha de conexão genérica.
  O modo novo exige AMBAS, uma credencial de máquina e uma **base
  consentida** — sem base não há de onde derivar a pasta de cada projeto, e
  inventar uma gravaria no disco do usuário um caminho que ele nunca
  consentiu; sem as duas, rodar sem `--project` continua imprimindo o uso.
- **Um cliente do socket `/runner` NUNCA pode deixar o `phoenix.js` reconectar
  sozinho** ([RN-108](business-rules/web.md#rn-108)). O ticket é de
  uso único, e o auto-reconnect embutido repete os MESMOS `params` — então um
  socket construído sem `reconnectAfterMs` tenta de novo um ticket morto para
  sempre. Isto não é hipotético: `apps/runner/src/channel.ts` saiu assim
  enquanto o próprio docblock afirmava o contrário, e foi medido em uso real —
  o mesmo ticket recusado a cada ~5,13s (o teto do backoff interno da
  biblioteca), 61 `REFUSED CONNECTION TO EngineWeb.RunnerSocket` em poucas
  horas e, somado à política PRÓPRIA de retentativa do runner, 530 requisições
  em um minuto contra o teto de 300 req/min do `RATE_LIMIT_USER`. O limite é
  **por usuário**, então a negação de serviço caiu no NAVEGADOR do dono da
  conta, como 429 — não há terceiro não autenticado envolvido, mas um cliente
  mal construído basta para trancar o próprio usuário do lado de fora. A
  reconexão é sempre a política própria de quem chama, com ticket novo a cada
  tentativa; a opção agora é OBRIGATÓRIA no tipo (`OpcoesDoSocket`) e asserida
  por um teste sobre a opção passada ao construtor, já que um teste que só
  conferia "conecta" passou o tempo todo.
- **As duas rotas `/projects/:projectId/runner-device-keys` SÃO JWT de sessão
  comum**, ao contrário do `runner-ticket` acima — quem chama é uma tela (a
  seção de chaves de dispositivo das Configurações, e o
  `RunnerOnboardingPanel` reconhecendo uma máquina já pareada). Até o
  [ADR 0203](adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
  ([RN-687](business-rules/web.md#rn-687)) havia uma terceira, um `POST` pelo
  qual o navegador registrava a chave pública Ed25519 que acabara de gerar
  (ADR 0118). Esse fluxo foi aposentado e a rota saiu junto, porque não tinha
  outro chamador: as chaves agora nascem na máquina — `brabo-runner
  device-key create` ([RN-551](business-rules/runner.md#rn-551)) gera o par e grava a
  metade privada em disco, modo 600, em `$XDG_CONFIG_HOME/brabo/` (senão
  `~/.config/brabo/`) — e são registradas pelo instalador pela rota interna
  abaixo. A metade privada continua nunca atravessando o fio; só a JWK pública
  e o `id` do registro atravessam.
  O que esse CLI deliberadamente não tem é uma credencial com que registrar —
  o registro fica com quem detém o service token (o instalador,
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 1), então
  cada lado detém exatamente um segredo e nenhum vê o do outro. O arquivo que
  o runner lê nunca existe sem o seu `kid`: `create` grava um nome `.parcial`
  que o leitor ignora, e `finish --id <id>` carimba e renomeia. Chaves de
  projeto registradas pelo navegador ANTES do ADR 0203 continuam valendo: o
  `PatAuthGuard` ainda as aceita, o `GET` as lista e o `DELETE` as revoga. O
  `GET` lista as chaves do próprio chamador, revogadas
  inclusive ([RN-519](business-rules/api.md#rn-519)) — é o que torna a revogação
  alcançável, e até ele existir uma chave órfã (aba fechada no meio do fluxo
  de configuração automática) era invisível e permanente. Ele nunca devolve a
  JWK pública: a lista existe para revogar, e `lastUsedAt: null` é o sinal da
  órfã. O `DELETE` revoga a chave do próprio chamador, de forma idempotente,
  no mesmo formato da revogação de PAT por autosserviço. O `PatAuthGuard`
  é quem DEPOIS aceita um JWT assinado pela metade privada dessa chave no
  `runner-ticket`, buscado pelo cabeçalho `kid` igual ao `id` desta tabela; a
  guarda confere que a chave não foi revogada, mas nunca uma
  expiração — a chave em si não expira, só o JWT de TTL curto (≤60s,
  `exp - iat`) que o runner assina com ela a cada vez. Desde a
  [RN-543](business-rules/produto.md#rn-543) o `GET` devolve DUAS espécies e DIZ
  qual é qual (`especie`): uma chave de MÁQUINA (`projectId: null`) serve todo
  projeto do seu dono, então aparece na listagem de todo projeto — sem isso
  ela seria invisível e permanente em toda tela, o mesmo defeito que a RN-519
  fechou, renascido na espécie nova. A rota que cria chaves de MÁQUINA é
  `POST /internal/machine-device-keys`, abaixo
  ([RN-552](business-rules/api.md#rn-552)) — outra rota, outra credencial e outro
  chamador. O MATERIAL da chave que ela registra é produzido na máquina:
  `brabo-runner device-key create`
  ([RN-551](business-rules/runner.md#rn-551)) gera o par Ed25519 localmente e
  imprime só a JWK pública, então a metade privada nunca viaja. Desde a
  [RN-547](business-rules/produto.md#rn-547) o `install.sh` **encadeia as duas** no
  fim de uma instalação, e instala a unit de máquina com a chave resultante
  ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — que é o que
  torna real, e não hipotético, o custo declarado desta rota.
  Revogar uma chave de MÁQUINA pede ao engine que derrube o runner vivo em
  CADA projeto em modo runner que o dono alcança — uma chamada
  `{project, user}` por projeto, sem tocar o engine.
- **A chave de MÁQUINA também é alcançável por CONTA, sem projeto no
  caminho** ([RN-611](business-rules/api.md#rn-611)): `GET /users/me/machine-device-keys`
  e `DELETE /users/me/machine-device-keys/:deviceKeyId`, classificadas `jwt`
  porque o escopo é o próprio chamador, como o resto de `/users/me/*`.
  Elas existem porque a instalação de uma linha cria a conta e a chave de
  máquina ANTES de qualquer projeto, e toda outra listagem precisa de um
  `:projectId`: ali, a chave estava viva e inalcançável. São estreitas de
  propósito — só chaves de MÁQUINA (uma chave de projeto responde 404, o mesmo
  que uma chave inexistente ou de outra pessoa, então nada vaza) e só as do
  CHAMADOR (o `userId` vem do JWT de sessão e entra no `WHERE`; nenhum
  parâmetro nomeia outro usuário, e a visão de `maintainer` fica de fora, como
  a RN-519 decidiu).
  O `DELETE` é a mesma revogação da rota por projeto, delegada ao mesmo caso
  de uso: derruba as conexões vivas abertas COM aquela chave, em todo projeto
  (desde a [RN-685](business-rules/api.md#rn-685) o alvo é a chave, não
  `{project, user}`); sem projeto ainda, ela só registra a revogação, que é
  tudo o que há para parar — o agente de máquina que espera (RN-550) não tem
  conexão, e o próximo ticket dele é recusado.
- **Revogar uma chave de dispositivo agora alcança a conexão VIVA, e o alvo
  é `{project, user}` — nunca `{key}`**
  ([RN-520](business-rules/api.md#rn-520), [ADR 0147](adr/0147-agente-local-com-capacidades.md)
  ponto 6). O `DELETE` só barrava o PRÓXIMO ticket: um `brabo-runner` já
  conectado mantinha vivo o canal `terminal:<projectId>`, rodando comandos
  aprovados com a chave revogada, até cair sozinho. A api agora pede ao
  engine (`POST /internal/projects/:projectId/runner/disconnect`) que o
  derrube, e o engine alcança o pid do canal — a api nunca fala com o canal, e
  o engine nunca lê a tabela de chaves.
  A precisão que NÃO existe é por credencial, e isso é propriedade do caminho
  do ticket, não preferência: `runner_socket_tickets` guarda
  `project_id`/`user_id`/`kind` e nada mais, então qual PAT ou qual `kid` abriu
  aquele socket morre no `PatAuthGuard` e nunca chega ao engine. **Custo
  declarado:** um runner do MESMO usuário conectado com um PAT, ou com outra
  chave do mesmo projeto, também cai — e reconecta sozinho, porque a rodada
  seguinte pede ticket novo e uma credencial que continua válida o obtém. Um
  runner de outro usuário no mesmo projeto fica de pé. Derrubar a conexão é
  EFEITO COLATERAL: engine fora do ar, nenhum runner conectado ou um timeout
  nunca podem fazer o `DELETE` (204, idempotente) falhar ou virar 5xx — a
  mesma régua de `rag_searches` ([RN-479](business-rules/api.md#rn-479)) e
  `mirror_sync_result` ([RN-517](business-rules/api.md#rn-517)).
  **Revisado pela [RN-685](business-rules/api.md#rn-685)
  ([ADR 0201](adr/0201-revogacao-por-chave.md)): o alvo agora é a CHAVE.**
  O ticket registra qual credencial o pediu (o `kid`, ou o id do PAT), e a
  revogação pede ao engine
  (`POST /internal/runner/disconnect-credential`) que anule os tickets
  pendentes da credencial e derrube só os runners nascidos dela — o custo
  declarado acima sumiu: um runner do mesmo usuário com PAT ou outra chave
  fica de pé. A revogação de PAT (própria, ou como `maintainer`) agora derruba
  as conexões dele também. Uma conexão aberta com ticket anterior ao deploy
  (sem credencial) continua caindo pelo par, e um engine que não conhece a
  rota faz a api voltar a `runner/disconnect`; a rota do par também fica como
  alvo da remoção de membro.
  A visão de `maintainer` que o PAT tem (RN-427, listar/revogar de QUALQUER
  usuário) fica DE FORA para chaves de dispositivo — agora por decisão, não
  omissão: aquele par nasceu de resposta a incidente com um segredo
  COMPARTILHADO circulando, e a metade privada de uma chave de dispositivo
  nunca sai da máquina que a fez. Essa frase dizia "o navegador que a fez", e
  a [RN-551](business-rules/runner.md#rn-551) alargou o fabricante sem enfraquecer a
  afirmação: o terminal é agora um segundo gerador, e a metade privada continua
  nunca viajando — o que sai é a JWK pública. O que MUDOU é onde ela repousa:
  uma chave feita no navegador pousa numa pasta de projeto que o usuário
  escolheu, uma feita pelo CLI pousa em `$XDG_CONFIG_HOME/brabo/` com modo 600.
  Nenhuma das duas é alcançável pela api, e é disso que a decisão acima
  depende.
- **As rotas `engine-service` não são "internas" por convenção de nome.**
  O que as protege é o `EngineServiceGuard` comparando
  `X-Brabo-Service-Token` com o segredo compartilhado em tempo constante, mais
  a NetworkPolicy. O prefixo `/internal` é sinalização para humanos. Elas
  ficam **fora do JWT** via `@ServiceRoute()`: o token de usuário não funciona
  aqui e o service token não funciona em nenhuma outra rota — os dois
  mecanismos nunca se sobrepõem ([RN-035](business-rules/api.md#rn-035)).
- **`POST /internal/first-account` é um segundo caminho que cria USUÁRIO, e
  funciona em produção** ([RN-546](business-rules/produto.md#rn-546),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)). Declarado aqui
  em vez de deixado para ser descoberto. O registro normal é o primeiro
  caminho e não foi tocado; este existe porque uma instalação nova de uma
  linha não deixa ninguém entrar — o `.env` gerado não tem variável de e-mail,
  `MAIL_TRANSPORT` cai em `log`, e o registro espera um e-mail que ninguém
  envia.

  Ele é estreito por construção, por três motivos independentes. **É
  `engine-service`**, então o que o abre é o `BRABO_SERVICE_TOKEN` — que o
  próprio `install.sh` gerou e gravou com modo `600`, tornando-o prova de
  controle sobre a MÁQUINA, não sobre uma caixa de e-mail. **Recusa com `409`
  quando a instalação tem QUALQUER usuário**, condição sobre a instalação e não
  sobre o e-mail pedido, então não pode ser chamado repetidamente com endereços
  diferentes, e fica calado para sempre assim que alguém existe (inclusive
  depois de uma restauração de migração, [RN-530](business-rules/infra.md#rn-530)).
  **E nenhuma rota pública nasceu**: um "criar o primeiro owner" público é uma
  corrida entre quem instalou e quem varreu a porta, e `owner` do primeiro
  workspace não é papel que alguém recupere por HTTP.

  A conta nasce com o e-mail já verificado, e essa é a única coisa que esta
  rota relaxa — para um caso nomeado, nunca para o outro caminho. O que a
  verificação prova é *"esta pessoa controla esta caixa de e-mail"*; quem roda
  o instalador já provou a máquina, o `.env` e o daemon do Docker. A senha é
  digitada no TTY, lida sem eco, passada por hash com argon2id e descartada:
  nunca no `.env`, nunca no marcador, nunca num log, e nunca gerada por
  código nenhum.

  Uma janela é declarada em vez de fechada: a checagem "existe algum
  usuário?" roda dentro da transação, mas `READ COMMITTED` não impede que duas
  chamadas concorrentes com e-mails diferentes passem as duas. Fechá-la
  exigiria um advisory lock sobre a ausência de linhas, e não é ali que mora a
  contenção — quem alcança esta rota já detém o service token, ou seja, já
  controla a instalação.
- **`POST /internal/machine-device-keys` CUNHA UMA CREDENCIAL DURÁVEL DE
  USUÁRIO a partir de um segredo de máquina** ([RN-552](business-rules/api.md#rn-552),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4). Esta é
  a borda mais afiada que o service token tem, e é declarada aqui pelo mesmo
  motivo que a irmã acima: o próximo passo do instalador depois de criar a
  primeira conta é parear o agente local, e parear exige uma credencial — a
  única que existia era amarrada a um PROJETO, numa instalação que ainda não
  tem nenhum.

  **O que custa, dito com todas as letras:** um `BRABO_SERVICE_TOKEN` vazado
  agora pode FABRICAR uma chave de dispositivo que age como usuário contra
  rotas com checagem de papel (`POST .../runner-ticket`, e por ela o canal do
  runner), em vez de só falar com as rotas internas. A credencial alternativa
  — a do próprio usuário recém-criado — foi considerada e recusada porque
  contradiz o próprio [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md):
  a senha é lida no TTY, *usada e descartada*, e o ponto 5 afirma que o
  instalador *"não faz login por ninguém"*, e é por isso que a resposta da
  primeira conta deliberadamente não leva token de sessão. Exigi-la aqui
  forçaria o instalador a criar, na máquina, exatamente a sessão viva que
  aquele ADR recusou criar.

  Três contenções moram na ROTA, não neste parágrafo. **Não há `userId` no
  corpo**: o dono é o ÚNICO usuário da instalação, resolvido pela api, então o
  token nunca compra a escolha de qual credencial cunhar — com zero usuários ou
  mais de um ela recusa com `409` e não grava nada, o mesmo formato de condição
  da primeira conta (sobre a instalação, nunca sobre o argumento), e fica calada
  de vez assim que a instalação tem um time. **Registrar SUBSTITUI**: as chaves
  de máquina ativas do dono são revogadas na mesma transação, então uma máquina
  reinstalada é caso legítimo e mil chaves de máquina são impossíveis — teto
  por cláusula, não por um número que envelhece. **Uma JWK privada é recusada
  pelo nome**: `d` presente responde `400` dizendo o que chegou, pela mesma
  regra de domínio que o registro do navegador usa, porque guardar uma metade
  privada é o pior desfecho que esta rota tem.

  O que a chave concede não é alargado: ela dá ao agente local exatamente os
  projetos que o dono já alcança como `developer`, resolvidos contra o projeto
  pedido ([RN-543](business-rules/produto.md#rn-543)). Duas lacunas são declaradas em
  vez de escondidas: não há `GET` nem `DELETE` aqui (listar publicaria o
  inventário de credenciais de uma pessoa a quem detém só o segredo da máquina;
  revogar já existe onde tem um dono humano), e numa instalação que ainda não
  tem projeto nenhuma tela alcança uma chave de máquina —
  que é exatamente por que registrar substitui em vez de deixar órfãs para trás.
- **`/docs` e `/docs-json` NÃO estão na tabela, e essa é uma lacuna
  conhecida.** A Swagger UI é montada por `SwaggerModule.setup()` no nível do
  Express, não como controller, e o teste enumera via `DiscoveryService` — ele
  estruturalmente não as vê. As duas só existem com
  `NODE_ENV !== 'production'` (`main.ts`), são públicas, e servem o mesmo
  documento que a
  [referência gerada](reference/api.html) publica. Registrado aqui em vez de
  deixado de fora: o que o teste não alcança precisa estar na prosa.
- **`GET`/`POST /auth/dev-login` (acesso rápido por papel, AT-722) NÃO estão
  na tabela, de propósito.** O módulo só é registrado com
  `BRABO_AMBIENTE=local` e a imagem sem marca ou marcada `local`
  (`infrastructure/security/ambiente.ts`); o `route-surface.spec.ts` sobe o
  `AppModule` sem a variável, então a rota não existe para ele e fora de `local`
  responde 404. Quando existe é pública como o `/auth/login` (sem CSRF, sem
  rate limit) e emite a sessão de uma conta `<papel>@brabo.dev` do
  `ROLE_ORDER`, nunca de e-mail livre; sem usuário na instalação responde 409.
  Registrado aqui porque o teste não a vê (ADR 0245, RN-984).
- **`GET /projects/:projectId/agent-areas` passou a devolver dados reais, e a
  classificação não mudou** — continua `role:developer`, enquanto o `PATCH`
  do teto segue `role:maintainer`. Até a FASE 18 a tabela `agent_areas` nunca
  era escrita e a rota respondia `[]` a todos, o que fazia a classificação
  parecer permissiva por acidente, não por decisão. Com a área nascendo junto
  com o projeto ([RN-094](business-rules/api.md#rn-094)), a divisão volta ao
  que a FASE 14d pretendia: **ler** o teto é trabalho de quem executa;
  **mudá-lo** é decidir quanto o produto gasta sem perguntar, e é por isso que
  exige o mesmo papel que ativa a execução.
- **As cinco rotas `/projects/:projectId/rag/*` dividem o papel pelo mesmo
  critério do teto de paralelismo da área (RN-083)** (PROGRAMA 28, Onda 4 —
  RN-231..234, ADR 0080): `search` e `coverage` são `role:viewer` (leitura pura
  sobre o que já está indexado), e `reindex` é `role:maintainer` — dispara N
  chamadas ao repositório do projeto e ao provider de embedding, o mesmo "muda
  o que o produto gasta sem perguntar" que já justifica o papel mais alto em
  outras rotas de disparo caro. `local` (RN-455, ADR 0113) é
  `role:maintainer` também, pelo mesmo raciocínio: chama o provider de
  embedding e substitui o que o projeto tem indexado para aquele escopo. O
  corpo é TEXTO lido pelo navegador, nunca um caminho do host.
  `feedback` (RN-480) é `role:viewer`, o **mesmo** papel de `search`, e o
  critério acima é o porquê: votar não gasta nada nem configura nada — é
  observação, e é o único sinal de verdade que a medição do RAG tem
  (`medir:rag`). Subi-lo para `maintainer` esvaziaria esse sinal para não
  proteger nada. O voto continua contido no servidor: um `searchId` de outro
  projeto, ou um `chunkId` que não estava entre os resultados daquela busca, é
  400 — um voto sem posição não mede nada.
- **As quatro rotas `/projects/:projectId/code/*` são `role:viewer` e
  SOMENTE LEITURA** (FASE 26b). Ver o código de um projeto é a mesma permissão
  que ver o projeto — o mesmo corte de `GET /projects/:id/git/repository`. Três
  coisas fazem dessa aparente permissividade uma decisão e não um descuido:
  - **não há verbo de escrita no controller**, e não pode haver: a aba Código
    é para ler, e escrever é efeito externo, que nasce `proposed_action` e
    pertence a uma fase posterior. Um `@Post` neste arquivo é mudança de fase,
    não de rota;
  - **o caminho é contido num lugar SÓ** ([RN-095](business-rules/api.md#rn-095)),
    pela mesma checagem central da [RN-092](business-rules/api.md#rn-092) —
    e a contenção importa aqui mais que o papel, porque nos providers remotos o
    caminho vira segmento de URL da API do provider e um `../` troca o
    **endpoint**, não o arquivo;
  - **a credencial gasta é a do owner do workspace**
    ([RN-058](business-rules/api.md#rn-058)/[RN-082](business-rules/api.md#rn-082)),
    como na escrita. Ler custa o rate limit do provider, e é por isso que a
    busca tem orçamento: sem teto, um `viewer` poderia inflar a conta do owner
    à vontade.
- **Três rotas de gasto/curadoria nasceram na AT-632
  ([RN-952](business-rules/api.md#rn-952)..[RN-954](business-rules/api.md#rn-954),
  [ADR 0233](adr/0233-membro-ve-o-gasto-do-projeto-sem-credencial.md)).**
  `GET /projects/:projectId/spend/team` (`role:viewer`) devolve o total do
  projeto e o custo por agente/área a QUALQUER membro, e nunca provider nem
  credencial: a rota não tem parâmetro de dimensão e o caso de uso só pede
  `actor`. `GET /workspaces/:workspaceId/spend/me` (`role:viewer`) é o consumo
  PRÓPRIO somado por projeto: o ator vem do token e o escopo de ator impede
  `provider` por tipo (RN-187). `PATCH /workspaces/:workspaceId/models/:modelId/billing`
  (`role:owner`, o nível de `…/pricing`) grava a marca curada. O
  `?projectId=` do `spend-report` segue `owner` e responde 404 para projeto de
  outro workspace.
- **`GET /workspaces/:workspaceId/spend-report` passou a devolver o recorte
  por provider, que é um recorte por CREDENCIAL**
  ([ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md),
  [RN-186](business-rules/api.md#rn-186)/[RN-187](business-rules/api.md#rn-187)).
  Nenhuma rota nova e nenhuma mudança de papel — continua `role:owner`, como
  já era —, mas o que ela CONCEDE mudou, e é por isso que esta nota existe. O
  ADR [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) tinha recusado
  esse eixo exatamente por este motivo; o 0076 o revisa por decisão do dono do
  produto. O que agora segura a fronteira são DUAS barreiras independentes:
  `GET /projects/:projectId/spend/me` (`role:viewer`) não tem parâmetro de
  dimensão nenhum, e o TIPO recusa a combinação — um escopo com `actor` só
  aceita `Exclude<SpendDimension, 'provider'>`, então pedir provider na visão
  do membro não compila. A segunda é mais fraca que a garantia anterior ("a
  dimensão não existia"), e é por isso que são duas.
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` é
  `role:viewer` na tabela, mas isso é o PISO, não o teto**
  (RN-108). O `@RequireRole('viewer')` cobre `scope: "heartbeat"` —
  o socket de heartbeat/eventos ao vivo que já existe; `scope: "terminal"`
  exige `developer`, conferido DENTRO de `CreateSocketTicketUseCase`
  contra `request.effectiveRole` (o mesmo que o `RolesGuard` já
  resolveu), porque o papel mínimo depende do CORPO da requisição, não
  só da rota — o mesmo padrão de
  `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts`.
  Hoje nenhum caminho real pede `scope: "terminal"` (o socket do terminal
  interativo é a FASE 25); o valor já nasce certo para
  quando ele existir.
- **`POST /projects/:projectId/members` é `role:maintainer` na tabela,
  e esse papel é NECESSÁRIO mas não SUFICIENTE**
  ([ADR 0127](adr/0127-tetos-de-rebaixamento-em-project-members.md),
  [RN-472](business-rules/api.md#rn-472)). É o espelho da nota do
  `socket-ticket` acima: lá o papel da tabela é o piso e o
  corpo pode elevá-lo; aqui o papel da tabela é o portão inteiro que o
  `RolesGuard` aplica, e o caso de uso então recusa **dois movimentos com
  403 mesmo para quem o tem** — rebaixar alguém que é `owner` do
  WORKSPACE, e rebaixar a SI MESMO. Nenhuma rota nova e nenhuma troca de papel
  (`RequireRole('maintainer')`, como já era); o que mudou é que a
  classificação deixou de ser a resposta completa para "quem pode fazer o quê
  aqui". O motivo de isso não poder morar no `RolesGuard` é o mesmo que a nota
  do `socket-ticket` dá — a decisão depende do CORPO da requisição
  (`dto.role`) e do ALVO dela (`dto.userId`), que o guard não
  vê —, então a regra é uma função pura em
  `domain/iam/tetos-de-rebaixamento.ts` aplicada por
  `AddProjectMemberUseCase`, na FORMA dos tetos absolutos de
  `domain/actions/decide.ts` ([RN-418](business-rules/api.md#rn-418)): nenhuma
  chave de configuração, nada que possa ligá-los. O `owner` protegido
  é `workspace_members.role`, nunca `workspaces.created_by`.
  O que os tetos NÃO cobrem está escrito no ADR e na RN.
- **`DELETE /projects/:projectId/members/:userId` também é `role:maintainer`
  e também não basta** — a segunda porta do teto de auto-rebaixamento
  ([ADR 0156](adr/0156-teto-de-auto-rebaixamento-na-remocao.md),
  [RN-556](business-rules/api.md#rn-556)). O ADR 0127 deixou esta rota sem teto por
  uma premissa que se mostrou falsa — *"remoção é benigna"*. Apagar a linha de
  `project_members` não apaga um papel: ele **troca** o
  efetivo, porque `forProject` é `projectRole ?? workspaceRole`
  ([RN-471](business-rules/web.md#rn-471)). Um `maintainer` por linha de projeto que é
  `viewer` no workspace se rebaixava, de forma irreversível pela
  tela — repor a linha é `POST :projectId/members`, que exige o
  `maintainer` recém-abandonado; **sem** papel nenhum no workspace, a queda é
  para nenhum acesso. O teto agora é aplicado por `RemoveProjectMemberUseCase`,
  que teve de passar a receber o ATOR (a rota não o passava, então nenhum
  teto poderia ter sido aplicado), e a regra REUSA
  `ehAutoRebaixamento` — `remocaoEhAutoRebaixamento` delega a ela com
  o papel de workspace no lugar do pedido, nunca uma segunda régua.
  O teto 1 **não** tem par aqui, por decisão fixada em teste: `owner` é
  o topo do `ROLE_ORDER`, então remover uma linha de projeto só pode ELEVAR o
  papel efetivo desse usuário — e é justamente assim que se desfaz a restrição
  que o teto 1 proíbe criar. Preço declarado, já que o teto 2 não tem
  limiar: a auto-remoção de `owner` de projeto para `maintainer` de workspace é
  reversível e também é recusada — o único movimento benigno que muda
  desfecho, ainda alcançável por outro `maintainer`.
- **`POST /workspaces/:workspaceId/members` é `role:owner` na tabela, e
  isso também deixou de ser a resposta inteira** — a terceira rota desta família
  ([ADR 0157](adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md),
  [RN-557](business-rules/produto.md#rn-557)). O ADR 0127 nomeou esta rota como a mesma
  classe de defeito *um escopo acima*, e o ADR 0156 a deixou como decisão à parte;
  ela era um passa-adiante de doze linhas que **nunca recebia o ator**, então nenhum
  teto poderia ter sido aplicado. Aqui é pior que no projeto por dois motivos
  que lá não existem: nenhum nível acima segura a queda (no projeto,
  rebaixar a si mesmo derruba o papel efetivo para o do workspace, que muitas vezes
  segura), e **não há `@Delete` de membro nenhum** neste controller
  (medido) — desfazer é esta mesma rota, exigindo o `owner` recém-
  abandonado. Por isso `AddWorkspaceMemberUseCase` agora recebe o ator e recusa
  **mudar o SEU PRÓPRIO papel com 403, nos dois sentidos**. O teto **não
  conta owners**, de propósito: a cláusula não tem número para envelhecer (critério
  do ADR 0127), e ela já produz o invariante que uma contagem existiria para
  garantir — um workspace nunca chega a zero owners, já que remover o último
  exigiria que esse owner o fizesse. O teto 1 **não tem par neste
  escopo**, considerado e não espelhado: é uma regra sobre *inversão de
  hierarquia*, e o `@RequireRole('owner')` já torna a inversão impossível —
  quem pode chamar nunca está abaixo de quem toca. Acrescentá-lo, somado à
  rota de remoção ausente, faria de `owner` um estado absorvente do qual ninguém sai
  por HTTP, que é a classe de estado que o ADR 0127 nasceu para eliminar.
  Rebaixar **outro** owner, portanto, continua permitido — a única forma de a propriedade
  ser revogada, e reversível pela mesma rota por qualquer owner que reste.
- **`DELETE /workspaces/:workspaceId/members/:userId` é `role:owner`, e é
  a quinta porta da mesma família**
  ([ADR 0173](adr/0173-remocao-de-membro-de-workspace.md),
  [RN-615](business-rules/api.md#rn-615)). Ela não existia quando o ADR 0157 foi
  escrito — a frase acima sobre "nenhum `@Delete` de membro" descreve aquele
  momento. Ela carrega o mesmo teto sem regra nova: `remocaoEhAutoRebaixamento`
  com o papel de workspace como o efetivo de hoje e *nenhum* como o papel
  de depois, já que nenhum nível acima segura a queda — então **remover a SI MESMO é
  sempre 403**. Essa mesma cláusula é o que protege o **último owner**, sem
  contar: só um `owner` chama a rota, ninguém remove a si mesmo, então
  toda chamada bem-sucedida deixa ao menos o chamador como `owner`. Remover
  **outro** owner é permitido (é como a propriedade é revogada por inteiro), e
  o teto 1 continua sem par aqui — o `@RequireRole('owner')` segue
  impedindo a inversão de hierarquia. A remoção também **cascateia**, numa
  transação: as linhas de `project_members` do alvo neste workspace (sem
  isso a regra de projeto-sobrepõe-workspace o manteria dentro de todo projeto
  onde ele tinha linha própria), as chaves de dispositivo de PROJETO dele e os PATs dele
  aqui (todo PAT pertence a um projeto); depois do commit a conexão viva do runner
  dele em cada projeto é derrubada, em melhor esforço, pelo caminho da
  RN-520. Declarado e não feito: chaves de máquina (da conta inteira; elas deixam de alcançar
  este workspace porque o papel resolve para nenhum), sockets de
  sessão já conectados. O **titular** (`workspaces.created_by`, cujas
  credenciais de LLM e de git os agentes gastam, RN-058) não pode ser removido: 409
  `criador_do_workspace` até que `PUT /workspaces/:workspaceId/owner-of-record`
  (`role:owner`, o destino já tem de ser `owner`, senão 409
  `titular_precisa_ser_owner`) a transfira — [RN-616](business-rules/api.md#rn-616).
  Qualquer owner pode transferi-la, inclusive para outro owner que não pediu.
- **`GET /workspaces/:workspaceId/members` é `role:viewer`, não o `owner`
  das três rotas de escrita ao lado** ([RN-652](business-rules/web.md#rn-652),
  AT-335). O mínimo é o do endpoint (RN-102): ler a lista não é
  mantê-la. `viewer` é o que as leituras vizinhas usam
  (`GET /workspaces/:workspaceId`, `/projects`) e o que
  `GET /projects/:projectId/members` usa — a leitura que esta completa, já que
  quem entra num projeto só pelo papel de workspace não tem linha de
  projeto. Quem pode abrir uma sessão pode ver quem falou nela, e um
  `viewer` de workspace já vê todo projeto do workspace. O corpo tem
  a mesma forma da leitura de projeto — `userId`, `name`, `email`, `role` —
  e nada mais (sem `createdAt`, sem estado da conta).
- **A auto-PROMOÇÃO agora é recusada nas duas rotas de associação**, o que muda
  também `POST /projects/:projectId/members`. O ADR 0127 a tinha registrado como
  capacidade que ficava (*"os tetos são sobre descer"*); o ADR 0157 revisa
  isso. As duas metades são um movimento só — uma pessoa decidindo sozinha que autoridade
  tem — e a metade de subida é a única que **escala privilégio**,
  justamente o que o ADR 0127 podia afirmar que seus tetos nunca faziam. Reescrever o MESMO
  papel continua passando: um upsert idempotente não é movimento. A comparação
  ficou num lugar só: `autoMovimentoDoProprioPapel` devolve o SENTIDO em vez
  de um booleano (o chamador precisa dele para escolher a mensagem), e
  `ehAutoRebaixamento` sobrevive como leitura dele para que a porta da REMOÇÃO
  continue vendo só a metade de baixo, como o ADR 0156 decidiu.
- **`jwt` sem papel não quer dizer sem autorização.** Em
  `/users/me/*` o escopo é o próprio usuário; em `GET /workspaces`
  a listagem já é filtrada pela associação de quem chama.
- **`X-Brabo-Service-Token` passou a ser redigido no log**
  ([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).
  Ele é o portador de todo o tráfego api↔engine e **não** estava na lista
  `redact` do pino: se caísse num corpo de erro logado, iria para o
  Loki em texto puro e com retenção. `serviceToken`, `privateKey`,
  `encryptedDek` e `dek` entraram junto. A lista completa está
  em `apps/api/src/infrastructure/observability/logger.config.ts`, e
  há um teste afirmando cada caminho — a lista é contrato, não
  conveniência.
- **O `allowedHeaders` do CORS é explícito**, e a lista precisa conter
  todo cabeçalho que o web envia: `Content-Type`, `Authorization`,
  `X-CSRF-Token` e `traceparent`. Faltar um não quebra teste nenhum
  (nenhum teste faz preflight) e quebra o navegador.
- **O engine tem CORS só nas rotas de saúde**
  ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)).
  `/health`, `/live` e `/ready` devolvem
  `Access-Control-Allow-Origin` para as origens de `WEB_ORIGIN`;
  **`/internal/*` e `/metrics` não**, e a exclusão é o
  ponto. As 13 rotas internas são servidor-a-servidor com um segredo
  compartilhado ([RN-035](business-rules/api.md#rn-035)); CORS ali não
  habilitaria nada — o cliente HTTP da api ignora esses cabeçalhos —, mas
  **anunciaria a um navegador que ele é cliente esperado daquele
  canal**. Há um teste afirmando a ausência, e um afirmando que a
  lista de caminhos tem exatamente três entradas, para que mover a fronteira apareça
  no diff.
- **Origem desconhecida recebe resposta, não `403`.** Nos dois serviços,
  a requisição é atendida e sai sem o cabeçalho; quem bloqueia a
  leitura é o navegador, de quem é a decisão. Responder `403`
  quebraria todo cliente que não manda `Origin` — a probe do kubelet,
  `curl`, `docker/smoke.sh`.
- **`POST .../delegations` é engine-service como as outras rotas
  internas** (QA da Fase 8b, Infra da Fase 8c — ADR 0038) — o lead de cada área
  registra o desfecho de cada delegado (`completed`/`failed`/`dispensed`)
  SEPARADO da chamada que a área usa para reportar o resultado
  consolidado para fora (`gates/verdict` no QA, `open_infra_pr` na
  Infra). Escopo de sessão, não de tarefa — `taskId` é opcional no
  corpo. Delegação nunca é visível como handoff.
- **`POST /projects/:projectId/execution/activate` ganhou um
  `originSessionId` opcional no corpo, e a classificação não mudou**
  — continua `role:maintainer` (RN-135). O campo deixa quem já tem
  esse papel fechar a sessão de CHAT que originou o pedido, mas com
  duas contenções que impedem usá-lo para fechar a sessão de
  outra pessoa: `findInProject(projectId, originSessionId)` recusa em silêncio
  um id que não pertence ao PRÓPRIO projeto do caminho, e o fechamento
  só acontece se `GetSessionPendingWorkUseCase` (a mesma guarda do
  heartbeat de inatividade, [RN-073](business-rules/engine.md#rn-073)) confirmar
  que não há handoff, ação ou turno pendurado ali. Nunca fecha a
  sessão de execução que a própria chamada acabou de ativar.
- **`GET /internal/sessions/:sessionId/pending-work` ganhou
  `aguardandoUsuarioDesde`, e nenhuma rota mudou de classificação**
  ([RN-581](business-rules/api.md#rn-581)). Continua `engine-service`: o campo
  é o instante em que o turno de um agente conversacional terminou, lido do mesmo
  event log que o engine já escreve, e só decide por quanto tempo o
  engine mantém uma sessão aberta. A mesma RN fez as rotas de sessão que
  acrescentam conversa (`POST .../agents/:agent/message`, o chat,
  handoffs, `POST .../agents/:agent/start`,
  `POST /internal/sessions/:sessionId/events`) responderem **409**
  `sessao_encerrada` em sessão terminal — uma recusa por ESTADO, depois
  da checagem de papel, nunca um papel novo. `terminationReason` nas
  respostas de sessão ganhou um valor documentado, `conversation_idle_timeout`.
- **`POST /projects/:projectId/execution/activate` recusa com `409` quando
  o projeto não tem repositório, e a classificação não mudou**
  — continua `role:maintainer` ([RN-582](business-rules/api.md#rn-582),
  [ADR 0165](adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)). A
  recusa vem antes de qualquer efeito. A mensagem é escolhida a partir dos
  handoffs do projeto, lidos em TODAS as sessões dele — por isso ela pode dizer "aceite
  o handoff ao Arquiteto/Dev Lead". O que ela revela é só que esse
  handoff existe e o status dele, que qualquer `viewer` do projeto já lê
  por `GET .../sessions/:sessionId/handoffs`; ela nunca nomeia sessão nem
  usuário.
- **Oferecer handoff a um agente já ativo no projeto é `409`
  `agente_ja_ativo`, e a classificação não mudou** — a rota humana
  `POST .../sessions/:sessionId/handoffs` continua `role:developer` e a
  interna continua `engine-service` ([RN-635](business-rules/api.md#rn-635),
  [ADR 0182](adr/0182-ciclo-de-vida-do-handoff.md)). Ao contrário da recusa acima,
  esta NOMEIA uma sessão: a mensagem diz em que sessão do mesmo
  projeto o destino está ativo, porque é o texto que o agente lê como
  resultado de ferramenta e o ponteiro de que uma pessoa precisa para ir falar com ele. Qualquer `viewer` do
  projeto já lista as sessões dele e lê `agent.activated` em cada uma,
  então nada atravessa fronteira de projeto. As mesmas rotas agora respondem com a
  oferta CORRENTE em vez de sempre uma linha nova (`desfecho`), e a interna
  aceita `seAusente` — uma chave que só pode fazer a chamada escrever MENOS.
- **O `POST /internal/sessions/:sessionId/handoffs` interno agora pode ACEITAR
  a oferta Criativo→PO que ele cria, e a classificação não mudou** —
  continua `engine-service` ([RN-658](business-rules/api.md#rn-658),
  [ADR 0185](adr/0185-estou-pronto-fecha-os-dois-gates.md)). O engine não ganha
  poder de ativar agente: quem decide é a api, a partir do `readiness.confirmed`
  que uma PESSOA gravou por `POST .../readiness` (`role:developer`, o mesmo
  mínimo de aceitar pelo card), e ela grava essa pessoa como o ator. O
  engine não consegue forjar a marca — ele nunca escreve `readiness.confirmed` — e
  a oferta precisa carregar o `product_brief` nascido depois daquele clique, na mesma
  sessão. `POST .../agents/criativo/validate-necessity` mantém a rota e o
  papel, sem chamador no web ([RN-657](business-rules/api.md#rn-657)).
- **`GET /projects/:projectId/execution/session` é `role:viewer`, o
  mesmo papel de `GET /sessions/:sessionId`**
  ([RN-139](business-rules/api.md#rn-139)). Devolve a sessão de execução
  CORRENTE do projeto — `active` com `execution.activated` gravado — ou
  `null`; nunca a sessão mais recente do projeto, que era o que a
  aba Executores lia e que trocava de sessão em silêncio no
  instante em que outra sessão nascia depois dela.
- **`GET /workspaces/:workspaceId/projects-summary` ganhou
  `roster.activatedAgents`, e a classificação não mudou** — continua
  `role:viewer`. O campo é a lista de ids de agente com um `agent.activated`
  na sessão mais recente do projeto ([RN-630](business-rules/api.md#rn-630)),
  calculada na mesma varredura por sessão que já produz
  `executionActivated` e `gatesEverOpened` ([RN-568](business-rules/web.md#rn-568)).
  Não nomeia usuário, sessão nem credencial, e não acrescenta consulta.
- **`POST .../llm-turn` e `POST .../llm-turn-stream` ganharam
  `modelName` no corpo da resposta/quadro final, e a classificação
  não mudou** — continua `engine-service` como sempre
  ([RN-146](business-rules/api.md#rn-146)). O nome do modelo já
  era resolvido para chamar o provider; ele só passou a viajar de volta ao
  engine, que o inclui no payload de `agent.response`. Nenhum dado novo
  é lido, nenhuma credencial nova é exposta — é o mesmo nome que
  já aparece em `token_usage`.
- **`PUT /projects/:projectId/agent-autonomy` passou a aceitar
  `actionType: "*"` — o "modo automático" ([RN-153](business-rules/api.md#rn-153))
  — e a classificação não mudou:** continua `role:maintainer`,
  o mesmo do `GET` ao lado. A diferença é o que o corpo agora
  AUTORIZA, não quem pode chamar: a curinga concede autonomia para QUALQUER
  tipo de ação do agente de uma vez, em vez de um tipo por vez como antes.
  A resolução (regra ESPECÍFICA sempre vence a curinga) mora
  inteira no repositório
  (`DrizzleAgentAutonomyRepository.findMode`), nunca em `decide()` —
  que continua recebendo só a `PermissionPolicy` já resolvida,
  exatamente como antes de a curinga existir. É por isso que os três
  tetos absolutos — merge em branch protegida, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — continuam bloqueando mesmo com a
  curinga em `auto_approve` ([RN-154](business-rules/api.md#rn-154)):
  eles reagem a `current.policy === 'auto_approve'`, nunca a de onde ela
  veio, e nenhuma exceção precisou entrar em `decide()` para isso continuar
  valendo. O `ApprovalCard.tsx` só oferece o botão que grava a
  curinga a um cliente que já sabe ter `maintainer`/`owner` —
  mas o que de fato garante o papel é este mesmo
  `@RequireRole('maintainer')`, inalterado.
- **O roteador de ferramentas Jev é uma chamada de SAÍDA nova levando contexto de agente**
  ([ADR 0179](adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md),
  [RN-625](business-rules/engine.md#rn-625)). Antes de uma chamada de chat a um modelo do
  OpenRouter, a api faz POST em `https://openrouter.ai/api/alpha/decisions` (a
  Decisions API, alfa) com a chave do OpenRouter do owner do workspace — a MESMA
  chave que o chat já gasta, decifrada no mesmo caso de uso, nunca logada
  e nunca devolvida. O que viaja é o `state`: o id do agente, a última
  mensagem do usuário (cortada em 6.000 caracteres), o começo da mensagem de sistema (1.500)
  e até seis chamadas de ferramenta recentes com argumentos e resultados cortados em 500
  caracteres cada — mais os NOMES e as DESCRIÇÕES das ferramentas, nunca os
  `parameters` delas. É conteúdo que a chamada de chat já manda para a mesma
  conta do OpenRouter, numa fatia menor, mas que agora chega a um segundo modelo
  (`typesafe/jev-1.13`) por trás dela. A chave é por workspace
  (`PUT /workspaces/:workspaceId/tool-router`, `role:owner`, ligada por padrão) e
  só dispara com modelo de chat do OpenRouter. O roteador estreita o menu de
  ferramentas e nada mais: não consegue aprovar, negar nem alargar nada, e uma
  chamada que o modelo faça fora do menu continua virando Proposed Action sob
  a mesma política. Qualquer falha da chamada cai no catálogo inteiro.
- **`POST .../actions/:actionId/approve_always` ganhou `desfecho` e
  `padraoGravado` na resposta, e a classificação não mudou** —
  continua `role:developer` ([RN-642](business-rules/api.md#rn-642)). A aprovação
  e o padrão gravado agora dividem uma transação; clicar numa ação que
  já estava APROVADA responde `201` com `desfecho: "ja_aprovada"` em vez de
  `409`, e uma ação RECUSADA continua respondendo `409` (`acao_ja_recusada`) sem
  nada gravado. Os tetos da RN-418 e `container_remove` continuam recusados
  com `400` antes de qualquer estado ser lido, então o caminho idempotente nunca grava
  um padrão que o teto proíbe.
- **Um erro de git ganhou resposta nomeada nova: `409 merge_conflict`** — nenhuma rota,
  papel ou guard mudou ([RN-704](business-rules/api.md#rn-704)).
  `GitProviderErrorFilter` mapeia `GitMergeConflictError` (o merge do
  repositório local achou conflito) para `409` com os arquivos em conflito na
  mensagem; a ref de destino fica intacta e a pull request continua aberta.
  Pelo pipeline de aprovação a ação `git_merge` termina `failed` com
  essa mensagem, o mesmo caminho de `GitPullRequestAlreadyMergedError`.
- **`GET /projects/:projectId/actions` aceita `status=failed`** — mesma rota,
  mesmo papel `developer` ([RN-705](business-rules/api.md#rn-705)). Até aqui só
  `pending` era aceito; `failed` lista as ações do projeto cuja
  execução falhou, e EXIGE `actionType` (`400` sem ele), para que a
  leitura seja de um tipo e nunca o histórico inteiro. Devolve a mesma
  forma `ProposedAction` que a leitura de pendentes devolve; a ação de git falhada agora
  carrega o próprio `kind`, a mensagem de erro e, num conflito de merge, os
  nomes dos arquivos em conflito — caminhos do repositório que o mesmo papel já lê
  no diff.

- **Duas respostas ganharam campos na Rodada 135** — nenhuma rota, papel ou
  guard mudou. `GET /workspaces/:workspaceId/models/catalog` (`role:maintainer`)
  devolve `sugestao` por modelo ([RN-965](business-rules/api.md#rn-965)): a
  faixa de cobrança e o preço publicado pelo fabricante, com link e data da
  fonte — dado curado no repositório, não dado do usuário nem segredo, e nada
  é gravado pela leitura (quem aplica é o `owner`, pelas rotas de curadoria de
  sempre). `GET /projects/:projectId/sessions/:sessionId/token-usage`
  (`role:developer`) devolve `lastCall` por agente
  ([RN-969](business-rules/api.md#rn-969)): tokens de entrada, nome do modelo
  e janela da última chamada, do mesmo escopo de sessão que a soma já expunha,
  sem provider nem credencial.
- **A resposta do catálogo de modelos ganhou `reasoningBudget`** — nenhuma rota,
  papel ou guard mudou ([RN-914](business-rules/api.md#rn-914), ADR 0223). O campo
  (inteiro ou `null`) sai no DTO de modelo das leituras do catálogo que já
  existiam, com os mesmos papéis. É curadoria do produto (o orçamento de
  raciocínio provado por smoke), não dado do usuário nem segredo; a escrita é só
  por migration, sem rota nova.

## Tabela {#table}

<!-- INÍCIO DA TABELA — o teste parseia daqui até o fim do documento. -->

| método | caminho | classificação |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/oauth/:provider/callback` | public |
| GET | `/auth/oauth/:provider/start` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/gates` | jwt |
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| GET | `/runner-releases/binary` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| POST | `/internal/sessions/:sessionId/anamnese-window` | engine-service |
| POST | `/internal/sessions/:sessionId/delegations` | engine-service |
| GET | `/internal/sessions/:sessionId/dev-context` | engine-service |
| POST | `/internal/sessions/:sessionId/epics` | engine-service |
| GET | `/internal/sessions/:sessionId/events` | engine-service |
| GET | `/internal/sessions/:sessionId/pending-work` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/max-parallel-proposals` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/c4-diagram` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/module-routing` | engine-service |
| POST | `/internal/sessions/:sessionId/module-contracts` | engine-service |
| POST | `/internal/sessions/:sessionId/project-image` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| POST | `/internal/models/sync` | engine-service |
| GET | `/internal/graph/prompt-templates/:name` | engine-service |
| POST | `/internal/graph/prompt-templates` | engine-service |
| POST | `/internal/rag/search` | engine-service |
| POST | `/internal/rag/feedback` | engine-service |
| GET | `/internal/gates` | engine-service |
| GET | `/internal/projects/:projectId/git-remote` | engine-service |
| GET | `/internal/projects/:projectId/business-rules` | engine-service |
| GET | `/internal/projects/:projectId/backlog` | engine-service |
| GET | `/internal/projects/:projectId/product-metrics` | engine-service |
| GET | `/internal/projects/:projectId/module-contracts` | engine-service |
| POST | `/internal/projects/:projectId/workspace-verification` | engine-service |
| POST | `/internal/projects/:projectId/container-exec` | engine-service |
| POST | `/internal/projects/:projectId/mirror-sync-result` | engine-service |
| GET | `/internal/projects/:projectId/container-spec` | engine-service |
| POST | `/internal/projects/:projectId/qa-environments/:taskId/start` | engine-service |
| POST | `/internal/projects/:projectId/qa-environments/:taskId/remove` | engine-service |
| POST | `/internal/qa-environments/sweep` | engine-service |
| POST | `/internal/first-account` | engine-service |
| POST | `/internal/machine-device-keys` | engine-service |
| GET | `/internal/sessions/:sessionId/psychologist-context` | engine-service |
| POST | `/internal/sessions/:sessionId/stories` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/complete` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/update` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/archive` | engine-service |
| POST | `/internal/sessions/:sessionId/semantic-duplicate-check` | engine-service |
| POST | `/internal/sessions/:sessionId/story-modules` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/block` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/unblock` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/gate/open` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/status` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| GET | `/internal/sessions/:sessionId/tasks/in-progress-by-dev` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/runner/projects` | jwt |
| POST | `/runner/llm-credentials` | jwt |
| GET | `/llm/provider-capabilities` | jwt |
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials/:provider/test` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/users/me/machine-device-keys` | jwt |
| DELETE | `/users/me/machine-device-keys/:deviceKeyId` | jwt |
| GET | `/users/me/preferences` | jwt |
| PATCH | `/users/me/preferences` | jwt |
| POST | `/users/me/preferences/detected-language` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| PUT | `/projects/:projectId/execution-mode` | role:maintainer |
| PUT | `/projects/:projectId/mirror-path` | role:maintainer |
| PUT | `/projects/:projectId/container/network` | role:maintainer |
| GET | `/projects/:projectId/mirror-state` | role:viewer |
| GET | `/projects/:projectId/models` | role:viewer |
| GET | `/projects/:projectId/actions` | role:developer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| DELETE | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| DELETE | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/area-bindings/:areaKey` | role:viewer |
| PUT | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/agent-catalog` | role:viewer |
| GET | `/projects/:projectId/agent-costs` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/agent-areas` | role:developer |
| PATCH | `/projects/:projectId/agent-areas/:key/max-parallel` | role:maintainer |
| PUT | `/projects/:projectId/agent-areas/:key/budget` | role:maintainer |
| GET | `/projects/:projectId/code/blame` | role:viewer |
| GET | `/projects/:projectId/code/branches` | role:viewer |
| GET | `/projects/:projectId/code/file` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests/:pullRequestId/diff` | role:viewer |
| GET | `/projects/:projectId/code/search` | role:viewer |
| GET | `/projects/:projectId/code/tree` | role:viewer |
| POST | `/projects/:projectId/rag/search` | role:viewer |
| POST | `/projects/:projectId/rag/reindex` | role:maintainer |
| POST | `/projects/:projectId/rag/local` | role:maintainer |
| POST | `/projects/:projectId/rag/feedback` | role:viewer |
| POST | `/projects/:projectId/source-clicks` | role:viewer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/container/network` | role:viewer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/execution/session` | role:viewer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository/adopt` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/bootstrap/plan` | role:viewer |
| POST | `/projects/:projectId/git/bootstrap/plan/approve` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/plan/skip` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/acknowledge-protection-failure` | role:maintainer |
| GET | `/projects/:projectId/git/repository` | role:viewer |
| GET | `/projects/:projectId/hypotheses` | role:viewer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/accept` | role:developer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/dismiss` | role:developer |
| GET | `/projects/:projectId/infra-artifacts` | role:viewer |
| GET | `/projects/:projectId/instruction-versions` | role:viewer |
| GET | `/projects/:projectId/members` | role:viewer |
| POST | `/projects/:projectId/members` | role:maintainer |
| DELETE | `/projects/:projectId/members/:userId` | role:maintainer |
| GET | `/projects/:projectId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/model-binding` | role:maintainer |
| GET | `/projects/:projectId/model-bindings/resolved` | role:viewer |
| GET | `/projects/:projectId/permissions` | role:maintainer |
| PUT | `/projects/:projectId/permissions` | role:maintainer |
| POST | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens/all` | role:maintainer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId` | role:developer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId/admin` | role:maintainer |
| GET | `/projects/:projectId/open-questions` | role:viewer |
| POST | `/projects/:projectId/open-questions/:questionId/answer` | role:viewer |
| GET | `/projects/:projectId/run-instructions` | role:viewer |
| GET | `/projects/:projectId/runner-device-keys` | role:developer |
| DELETE | `/projects/:projectId/runner-device-keys/:deviceKeyId` | role:developer |
| GET | `/projects/:projectId/proficiency` | role:viewer |
| DELETE | `/projects/:projectId/proficiency/me` | role:viewer |
| POST | `/projects/:projectId/proficiency/me/opt-in` | role:viewer |
| GET | `/projects/:projectId/psychologist/analyses` | role:viewer |
| GET | `/projects/:projectId/psychologist/status` | role:viewer |
| POST | `/projects/:projectId/runner-ticket` | role:developer |
| POST | `/projects/:projectId/terminal-ticket` | role:viewer |
| GET | `/projects/:projectId/sessions` | role:viewer |
| POST | `/projects/:projectId/sessions` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId` | role:viewer |
| PATCH | `/projects/:projectId/sessions/:sessionId` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/messages/:messageId/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/structured-question/:questionSetId/answer` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/rearm` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/attachments` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/attachments/:attachmentId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/messages` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events/:eventId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/context-summary` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/execution/parallelize` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/handoffs` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs/:handoffId/accept` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/model-binding` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/psychologist/reanalyze` | role:maintainer |
| POST | `/projects/:projectId/sessions/:sessionId/readiness` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/response-language` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/response-language` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/socket-ticket` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/reopen` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/resume` | role:developer |
| POST | `/projects/:projectId/tasks/:taskId/gates/:gate/resume` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| GET | `/projects/:projectId/spend/team` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| PATCH | `/projects/:projectId/stories/:storyId/title` | role:developer |
| POST | `/projects/:projectId/stories/:storyId/archive` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| GET | `/workspaces/:workspaceId/members` | role:viewer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| DELETE | `/workspaces/:workspaceId/members/:userId` | role:owner |
| PUT | `/workspaces/:workspaceId/owner-of-record` | role:owner |
| PUT | `/workspaces/:workspaceId/tool-router` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| GET | `/workspaces/:workspaceId/spend/me` | role:viewer |
| GET | `/workspaces/:workspaceId/huggingface/models` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests/:id/confirm` | role:maintainer |
| GET | `/workspaces/:workspaceId/huggingface/pull-requests/:id` | role:maintainer |
| GET | `/workspaces/:workspaceId/llm-providers/credentialed` | role:viewer |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| PATCH | `/workspaces/:workspaceId/models/:modelId/billing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-base` | role:maintainer |
| GET | `/workspaces/:workspaceId/project-folders` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |
| GET | `/workspaces/:workspaceId/containers` | role:viewer |
