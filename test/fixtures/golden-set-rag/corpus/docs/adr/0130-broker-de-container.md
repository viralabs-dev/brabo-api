# 0130 — O broker de container: quem fala com o Docker do servidor, e por que ele não aceita especificação

## Context

O ADR 0065 decidiu que a imagem de um projeto é ARTEFATO do Arquiteto, e o ADR
0081 criou a tabela de ciclo de vida (`project_containers`). Nenhum dos dois
subiu container: até hoje o CLAUDE.md registra "FASE 25b segue cortada: NENHUM
serviço chama Docker". O ADR 0128 construiu o alicerce — uma `DockerPort` de
CINCO operações (`start`/`stop`/`remove`/`inspect`/`exec`) e um adaptador sobre
`execFile('docker', …)` — dentro de `apps/runner`, e escreveu, por antecipação,
que aquele arquivo MOVERIA quando o segundo consumidor nascesse: *"um segundo
arquivo com as mesmas cinco operações e uma sexta 'só no broker' é o começo do
fim da contenção"*.

Este ADR é esse segundo consumidor. Ele decide três coisas que não se separam:
onde a porta passa a morar, o que é o broker, e o que impede um serviço
root-equivalente no host de virar acesso arbitrário a Docker.

A decisão anterior que ele NÃO reabre: a api nunca recebe o socket. Nem o
engine. O socket é montado num serviço só, que existe para isso.

## Decision

### 1. A porta MOVE para `packages/docker-port`

`apps/runner/src/docker-port.ts` e `docker-cli.ts` (mais os dois `.spec.ts`)
passam a ser `packages/docker-port/src/`, num pacote de workspace novo
(`@brabo/docker-port`) consumido por `apps/runner` e `apps/broker`. Nenhum dos
arquivos foi copiado.

**`packages/shared` foi recusado, e o motivo é verificado, não estético.**
Aquele pacote é 100% TIPO, e o invariante é mantido honesto por
`apps/api/test/packages-shared-so-tipos.spec.ts` — o `main` dele aponta para
`.ts` cru, e a imagem de produção da api morre no boot com
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` se qualquer valor sobreviver ao
`tsc`. Uma porta com classes de erro, constantes e funções de validação é
código de runtime.

**O pacote novo não tem passo de build, e é isso que o torna consumível.** Os
dois consumidores o EMPACOTAM: o runner por `tsup` e por
`bun build --compile`, o broker por `tsup`. Nenhum dos dois o resolve de
`node_modules` em runtime dentro de uma imagem. Em desenvolvimento, o `.ts` é
executado direto pelo type stripping do Node — o link do pnpm é um symlink e o
`realpath` cai fora de `node_modules`, então a recusa do Node não se aplica
(medido, não suposto).

**Consequência declarada: a api NÃO pode consumir este pacote.** O
`pnpm deploy --prod` da imagem dela copia o pacote de verdade, sem symlink, e
aí o `realpath` cai dentro de `node_modules` — exatamente o erro que o teste do
`packages/shared` existe para prevenir. É por isso que
`validarDecisaoDeImagem` (o domínio da api) **não se move para cá**, e por que
o broker não o importa. O que o broker tem é um parse PRÓPRIO
(`especificacaoValidada`), e a próxima seção explica por que ele não é uma
segunda versão da mesma regra.

**Empacotamento, medido depois do movimento.** `pnpm --filter runner build`,
`build:bin`, `smoke` e `smoke:bin` continuam verdes; o binário standalone
(`linux-x64`) carrega a porta e consulta o daemon lá de dentro, que é o que o
ADR 0128 já provava. O bundle do Bun passou de 79 para 83 módulos. O pacote
entra como `devDependency` do runner — mesma prateleira de `phoenix` — porque
o `tsup` deixa `dependencies` como `require` EXTERNO e embute devDependency, e
porque o pacote publicado no npm não pode carregar um `workspace:*` que ninguém
fora deste repositório resolve. `npm pack --dry-run` em `apps/runner` continua
produzindo os mesmos quatro arquivos.

### 2. O broker não aceita especificação de container

`apps/broker` é um serviço Node/TS, da mesma família do runner: sem framework
web (são seis rotas), `node:http` puro, imagem própria em `docker/broker/`.

O que o torna não-arbitrário não é o allowlist de nada. É a FORMA da entrada:

> Ele recebe um `projectId` e uma das cinco operações. Vai à api LER a decisão
> do Arquiteto e o contexto do projeto (`GET
> /internal/projects/:projectId/container-spec`). COMPÕE a especificação ele
> mesmo. Não existe parâmetro em que se escreva `privileged`, `cap_add`,
> `network: host` ou um `-v` livre — porque não existe parâmetro.

Se a spec viajasse no corpo, a contenção de um processo root-equivalente no
host dependeria de o CHAMADOR estar correto. Uma chamada HTTP a mais é o preço
de a contenção não depender de ninguém, e é um preço baixo: a api está do outro
lado da mesma rede interna.

**Por que o broker revalida o que a própria api devolveu.** Porque ele não pode
pressupor a correção de quem lhe responde — e porque as duas validações
respondem perguntas diferentes. `validarDecisaoDeImagem`, na api, pergunta
"esta decisão de arquitetura é revisável?" (exige `rationale`, recusa `latest`,
aplica `RECURSOS_MAXIMOS`, devolve a recusa ao MODELO pelo tool-result).
`especificacaoValidada`, aqui, pergunta "posso entregar isto ao daemon?" — é o
parse de um JSON não confiável para dentro do tipo fechado. A sobreposição é
pequena e declarada (tag/digest, um teto numérico), e não é um espelho a
manter: os tetos daqui são os do BROKER, o último recurso que ele nunca
ultrapassa venha o pedido de onde vier. Hoje os números coincidem com os da api
de propósito; se um dia divergirem, o menor vence e nada quebra, porque nenhum
dos dois afirma ser o outro.

**Uma checagem existe só deste lado, e ela é nova:** referência de imagem que
começa com `-`. `image` vira argumento POSICIONAL de `docker run`, e
`--privileged` como "nome de imagem" seria lido pelo CLI como flag. `execFile`
sem shell resolve injeção de COMANDO; injeção de ARGUMENTO é outra coisa, e se
resolve aqui.

### 3. `pidsLimit` entra na porta

A `EspecificacaoDeContainer` do ADR 0128 tinha `cpus` e `memoriaMb`, e o
artefato do Arquiteto sempre teve três números — `RecursosDoContainer.pidsLimit`
é o que contém fork bomb sem depender de reconhecer comando. Sem o campo, o
broker leria o artefato e descartaria o terceiro: o artefato prometeria um teto
que o container não recebe, que é o "artefato que promete mais do que o
container recebe mente para quem o audita" que o próprio domínio da api nomeia.

Acrescentar campo à porta é movimento que merece nota, porque a régua deste
desenho é não acrescentar parâmetro. A régua vale para o que AFROUXA. Este
aperta, e vira `--pids-limit` ao lado de `--cap-drop ALL`.

### 4. Rede, porta e socket

- Rede PRÓPRIA no Compose (`broker`, `internal: true`), nos dois arquivos. A
  api participa de duas redes; o engine e o web não participam desta, então não
  alcançam o broker. `internal: true` também tira a rota de saída do broker
  para a internet, que ele não usa.
- **Sem porta publicada.** Nada no host precisa alcançá-lo.
- `/var/run/docker.sock` montado **só aqui**. `:ro` no socket seria cosmético
  — o protocolo do Docker é HTTP sobre aquele socket e toda operação escreve —
  e por isso não foi usado como se fosse contenção.
- Autenticação por `BRABO_SERVICE_TOKEN`, o mesmo segredo e o mesmo cabeçalho
  já usados api↔engine nos dois sentidos, comparado em tempo constante. Em
  produção o broker RECUSA subir com a variável vazia, com o literal público do
  repositório ou com menos de 16 caracteres — a régua do ADR 0059/RN-114, que
  aqui pesa mais do que em qualquer outro serviço.
- O broker sobe sob `profiles: ["container-broker"]` nos dois composes, e
  portanto **não sobe por padrão**. Nada o chama para escrever ainda; dar
  acesso ao Docker do host a toda máquina de desenvolvimento em troca de nada
  seria uma mudança de postura sem contrapartida. `docker/smoke.sh` roda sem
  profile e continua provando as mesmas três imagens.

### 5. Nenhum caminho atravessa a fronteira

A api não manda caminho nenhum — nem `workspace_path`, nem a raiz gerenciada. O
`-v` de um `docker run` é resolvido pelo DAEMON, contra o filesystem do HOST;
`/data/project-workspaces/<x>` é um caminho de dentro do container da api, e
mandá-lo faria o daemon criar e montar uma pasta VAZIA, com o dev agent
trabalhando num diretório sem código e nada indicando por quê.

O broker compõe o caminho com `PROJECT_WORKSPACES_HOST_ROOT`, configuração
DELE, mais o `workspaceDirName` congelado na criação do projeto (RN-109). Sem
essa variável, `start` recusa nomeando-a; as outras quatro operações continuam
funcionando. Recusar é a decisão: adivinhar produziria o mount vazio em
silêncio.

### 6. O que a api ganha, e o que ela deliberadamente não ganha

Ganha uma PORTA (`ContainerBrokerPort`) e um cliente HTTP. Das cinco operações
declaradas, **uma tem chamador**: `inspect`, pela rota de ciclo de vida do
container, que passa a devolver o estado OBSERVADO ao lado do REGISTRADO. As
outras quatro são efeito externo e não acontecem sem `proposed_action` — quem
vai propor é o Infra Lead, com autoridade final do usuário, e isso é outro PR.
Declarar as cinco agora e ligar quatro depois é o oposto de esconder um
gatilho: o método existe e nada o chama, o que qualquer busca por chamador
mostra em um segundo.

Não ganha nenhuma escrita nova. `RegistrarTransicaoDeContainerUseCase` continua
byte a byte como estava, guard de modo incluído — ele cai junto com o portão da
RN-105 nos três modos, num PR que decide as duas coisas ao mesmo tempo. Como
consequência, **o broker declara a mesma política do lado dele**: projeto
`mounted`/`runner` é recusado com 409, porque o código deles mora numa pasta do
usuário que o host do broker não enxerga. Mudar só um dos dois lados agora
deixaria a api e o broker discordando sobre o que existe.

## Consequences

**O broker é root-equivalente no host, e isso é o preço.** Está escrito, não
escondido. Contido por cinco camadas independentes: sem porta publicada; rede
interna que só a api alcança; token de serviço em tempo constante; cinco
operações de superfície fechada; e a especificação computada, nunca aceita.
Nenhuma delas confia nas outras.

**Um mecanismo, não dois.** O ADR 0128 deixava `dockerode` tecnicamente
possível no broker (ele nunca vira binário standalone). A decisão do dono do
produto foi CLI dos dois lados, e a razão não é técnica: dois mecanismos para a
mesma operação significam dois modos de falhar, duas superfícies de erro para
classificar e duas versões da tradução spec → daemon. O preço é a imagem do
broker precisar do binário `docker` dentro dela — `docker-cli`, só o cliente —
e ele está pago no Dockerfile, com `DockerCliAusenteError` nomeando o dia em
que alguém montar o socket sem instalar o cliente.

**A tabela `project_containers` agora pode MENTIR, e a leitura diz isso.**
Antes não podia: `container_id` era sempre NULL. A reconciliação é NA LEITURA,
não um daemon de fundo — container morto por fora aparece como registrado
`running` e observado `exited`. As duas colunas nunca se fundem, e "não
consegui olhar" tem motivo próprio (`broker-nao-configurado`,
`broker-sem-resposta`, `broker-recusou`) em vez de herdar o registrado. É a
RN-468 aplicada, e nenhuma recusa do broker derruba a leitura do registrado,
que é informação legítima por si só.

**Lacuna declarada:** um container órfão de um projeto que nunca teve linha de
ciclo de vida não aparece nessa rota — ela lê o registrado primeiro e só então
pergunta ao daemon. Quem acha órfão é a varredura por `brabo.managed=true`, e a
página global que a consome é outro PR.

**A imagem do broker NÃO é publicada no GHCR.** `docker-bake.hcl`,
`scripts/ci/images-manifest.ts` (`ALVOS`) e `release.yml` continuam com as
QUATRO imagens do ADR 0119. O broker sobe sob profile, não faz parte do deploy
padrão e nada o chama para escrever; publicá-lo agora colocaria no registry
público uma imagem que ninguém instala. Quando o PR do Infra Lead o tornar
necessário, entra pelo mesmo caminho dos outros quatro — é uma linha em cada um
dos três lugares, e o `ALVOS` tem teste.

**A FASE 25b deixa de estar inteiramente cortada, e só isso.** Existe um
serviço capaz de chamar Docker, e um caminho de LEITURA que o chama. Nenhum
container sobe: não há laço, não há fila, não há `proposed_action` de
`container_start`. A frase do CLAUDE.md muda para dizer exatamente isso, e nada
além.

**Novidade operacional que não existia:** `DOCKER_GID`. O socket é
`root:docker` no host e o processo do broker roda non-root, então o compose usa
`group_add`. O default (999) é o mais comum e está errado em várias
distribuições; errar produz "permission denied" no socket, que
`DockerIndisponivelError` já nomeia com a dica do grupo. Está no `.env.example`
e no runbook.
