# Superfície exposta da api

Toda rota registrada, com a classificação de autenticação e a
justificativa das que ficam abertas. Decisões no
[ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Este documento é a fonte de verdade de um teste**, não a cópia de um.
> `test/interfaces/route-surface.spec.ts` sobe a aplicação,
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
  nenhuma. O mesmo `PATCH /projects/:projectId` (`maintainer`, sem mudança de
  papel) passou a aceitar `taskBudgetMicros` (RN-1142, propagado ao engine por
  chamada interna best-effort) e `modelEscalation` (a escada de modelos,
  RN-1143/RN-1146).
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
- **`POST /internal/projects/:projectId/app/restart`** ([RN-1026](business-rules/api.md#rn-1026))
  é chamada só pelo engine, depois que a pasta do projeto avançou. Ela repassa
  a `ContainerBrokerPort.reiniciarApp`. O corpo é vazio: o comando do app
  nunca trafega, o broker o lê do container-spec. A resposta é tipada
  (`reiniciou`, `motivo`, `exitCode`) e não leva texto livre nem log, porque
  o comando do app pode conter um segredo.
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
- **`PUT /projects/:projectId/auto-merge` e `POST /internal/projects/:projectId/tasks/:taskId/auto-merge`
  abrem a ÚNICA exceção do teto de merge** ([RN-1316](business-rules/api.md#rn-1316),
  [ADR 0292](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0292-o-merge-automatico-e-opcao-do-projeto-desligada-por-padrao.md)).
  A chave `projects.merge_automatico` (padrão `false`) só muda pela rota
  própria, nunca pelo `PATCH`: ligar exige `owner` do workspace (a rota exige
  `maintainer` e o caso de uso recusa o resto com 403), desligar basta
  `maintainer` e vale na proposta seguinte; cada mudança grava uma linha
  imutável em `merge_automatico_eventos`. A rota interna é só do engine
  (service token) e confere TUDO na api (chave, gates, PR, merge duplicado da
  RN-663) antes de propor o `git_merge` com `origem: merge_automatico`. Em
  `decide()` a exceção exige as TRÊS condições juntas (chave ligada, origem do
  gatilho, destino na branch de trabalho): `ProposeActionInput.origem` não vem
  de DTO nenhum, então pessoa, agente, "sempre permitir" e `permissions.json`
  nunca a carregam; `git_merge` continua em `TIPOS_SEM_SEMPRE_PERMITIR`.
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
- **`POST /internal/projects/:projectId/open-questions/:questionId/answer`**
  ([RN-1002](business-rules/api.md#rn-1002)) é chamada só pelo engine
  (`engine-service`): um agente fecha a pergunta em aberto que o usuário
  respondeu no chat. O mesmo núcleo da resposta humana; idempotente; restrita
  ao projeto.
- **`POST /internal/projects/:projectId/business-rules/:ruleId/retire`**
  ([RN-1018](business-rules/api.md#rn-1018)) é chamada só pelo engine
  (`engine-service`): o Criativo ou o PO retira uma regra de negócio obsoleta.
  O papel é conferido no corpo (`criativo`/`po`, senão 403) e a chamada
  precisa citar a regra que substitui e/ou uma pergunta respondida. Ela anexa
  um evento `artifact.business_rule_retired` e troca o id da regra nas
  histórias que a citam; nada é apagado e nenhuma credencial entra.
- **`POST /internal/projects/:projectId/qa-environments/:taskId/compose`**
  ([RN-1328](business-rules/api.md#rn-1328), ADR 0297) é chamada só pelo engine
  (`engine-service`). O corpo é vazio e a api não manda especificação ao broker
  (a allowlist do compose mora no broker); a resposta traz só status de sonda e
  nomes de campo recusados, nunca o conteúdo do compose nem saída de build.
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

A continuação das notas e a tabela de rotas estão em [`security-surface-parte-2.md`](security-surface-parte-2.md). O teste lê as duas partes como um documento só.
