# ADR 0104 — `execution_mode` em três valores, e o workspace nasce `unverified` quando o runner é quem verifica

- **Status:** Aceito
- **Data:** 2026-08-22
- **Contexto:** os ADRs 0072 e 0103 nunca foram reconciliados entre si
- **Revisa (sem atenuar) o terreno de:** [ADR 0072](0072-projeto-local-ou-container.md), [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## Contexto

Dois ADRs deste produto descrevem execuções fisicamente incompatíveis sob o
MESMO nome de campo, e ninguém tinha reconciliado os dois até agora.

O [ADR 0072](0072-projeto-local-ou-container.md) criou
`projects.workspace_mode` (`'container'|'local'`) + `workspace_path`. No
modo `local`, a [RN-170](../business-rules/autenticacao.md#rn-170) valida na CRIAÇÃO que
a pasta está **montada por bind-mount** dentro dos containers da api E do
engine — `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
(`validarCaminhoDeWorkspaceLocal`) roda `access(W_OK|X_OK)` **dentro do
processo do container da api**, e recusa com 400 quando não acha. O wizard
web (`apps/web/src/routes/NewProjectWizard.tsx:71,462-468`) só ensina a
editar `docker/docker-compose.yml` com uma linha de bind-mount — não existe
outra instrução.

O [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) criou
`apps/runner`: um CLI que roda na MÁQUINA do usuário, **sem bind-mount
nenhum**, conectando ao engine por canal Phoenix (`/runner`, tópico
`terminal:<projectId>`) autenticado por ticket de uso único emitido pelo
próprio engine. Ele executa comando de agente já aprovado pelo pipeline
normal e abre terminal PTY interativo de verdade — a aba Terminal
(`apps/web/src/routes/code/TerminalPanel.tsx`) já usa `@xterm/xterm` de
verdade para isso. A [RN-420](../business-rules.md#rn-420), que decide
quando rotear um comando pro runner em vez do `System.cmd` de sempre, reusa
a MESMA condição `workspace_mode == "local"` (mais runner conectado) — o
ADR 0103 nunca criou um terceiro valor para o campo.

O resultado prático: hoje, para USAR o runner — que existe exatamente para
dispensar bind-mount —, o usuário ainda é obrigado a passar pela validação
de bind-mount do ADR 0072 só para criar o projeto. As duas metades do
produto citam o mesmo enum de 2 valores para descrever duas execuções que
não têm nada em comum fisicamente: uma pasta montada nos dois containers, e
uma pasta que só existe na máquina do usuário. Confirmado por leitura direta
do código: `apps/api/src/db/schema.ts:238-240`
(`projectWorkspaceModeEnum = pgEnum('project_workspace_mode', ['container',
'local'])`) e `apps/api/src/domain/iam/project.entity.ts`
(`PROJECT_WORKSPACE_MODES = ['container', 'local']`, cujo comentário
existente já avisa do risco de confundir o homônimo com o `GitProviderName`
`'local'` — risco que este ADR herda e precisa preservar ao renomear o
campo).

Este achado surgiu investigando "o que falta para o produto de fato acessar
pasta e terminal do usuário fora do escopo de Docker" — não estava
registrado em lugar nenhum como divergência formal antes desta sessão.

## Decisão

1. **`execution_mode` substitui `workspace_mode`, com três valores:**
   `container` (default, comportamento de sempre — tudo dentro do Docker),
   `mounted` (o antigo `local` — bind-mount, RN-170 continua valendo, agora
   condicionada a este valor) e `runner` (a pasta só existe na máquina do
   usuário, sem bind-mount nenhum). O nome muda porque `local` já carregava
   a ambiguidade com `GitProviderName`, e passaria a precisar carregar DUAS
   semânticas físicas incompatíveis (montado vs. não-montado) sob o mesmo
   rótulo — `execution_mode` nomeia o eixo real que o campo decide (ONDE o
   comando executa), não mais "onde o código mora", que os dois modos novos
   respondem de formas que não podem compartilhar validação.

2. **RN-170 passa a ser condicional a `execution_mode = 'mounted'`.** Para
   `execution_mode = 'runner'`, a criação continua validando a parte LÉXICA
   do caminho (absoluto, sem `..` em nenhum segmento, fora da raiz e das
   pastas de sistema, sem sobreposição com o checkout do Brabo nos dois
   sentidos) — nada disso depende de I/O do container, e continua valendo
   porque é o mesmo escopo que autoriza o terminal do agente
   ([ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)). O que
   muda é a parte de DISCO (existe, é pasta, é gravável): para `mounted`
   continua rodando na criação, dentro do container da api, como hoje; para
   `runner` essa verificação é ADIADA — não tem como a api confirmar algo
   que só existe na máquina do usuário. Quem tem autoridade para fazer esse
   `access()` é o runner, rodando no host de verdade.

3. **Projeto em `execution_mode = 'runner'` nasce com `workspace:
   unverified`, promovido a `verified` quando o primeiro runner conecta e
   confirma o caminho no host.** Mesmo espírito de estado pendente com
   evidência por evento que `docs/gates.yml` já usa para gate `status:
   planned` + `evidencia: event_log` — a pasta declarada é aceita de
   imediato (a criação não trava esperando um runner que ainda não existe),
   mas o produto não afirma "o caminho é válido" até ter prova de que
   alguém, na máquina certa, confirmou isso. O MECANISMO exato — nome do
   evento, rota que o runner chama para confirmar, onde o estado é gravado
   — fica para a sessão de implementação: este ADR declara a EXISTÊNCIA do
   estado e o CRITÉRIO de promoção, não a mecânica.

4. **Consequência, não pedido em separado: converter `execution_mode` entre
   os três valores deixa de exigir recriar o projeto.** Hoje o modo só é
   escolhido na criação (ADR 0072, item 1) — com a diferença entre os
   valores reduzida a uma coluna (mais o estado de verificação do item 3),
   isso deixa de ser uma limitação estrutural. **Todas as direções de
   conversão passam a ser permitidas**, sem restrição própria declarada
   aqui — `container ⇄ mounted ⇄ runner`, em qualquer sentido. A mecânica de
   cada transição (o que acontece com o worktree/estado ao trocar, se há
   confirmação própria por direção) fica para a sessão de implementação;
   este ADR só declara que a conversão é permitida em qualquer sentido.

### Ordem de entrega do que fica para depois

Esta decisão (itens 1–3 acima) é **P1**: sem ela, o runner existe mas
ninguém consegue chegar nele sem primeiro montar a pasta que ele foi
desenhado para dispensar. O que fica para depois, na ordem que o dono do
produto já definiu (detalhe completo em
[backlog.md](../explanation/backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)):

- **Distribuição do runner** (`tsup` → pacote único + `npm publish
  @brabo/runner`) — hoje é `"private": true` com `bin` apontando pra um
  `.ts` cru, só alcançável clonando o monorepo inteiro.
- **Token de conta de longa duração (PAT)**, substituindo o replay de login
  de `apps/runner/src/auth.ts` — precisa vir ANTES da distribuição, porque
  publicar hoje distribuiria um fluxo de senha+cookie salvo em disco.
- **Exclusividade do runner por `{project_id, machine_id}`**, em vez de só
  `project_id` — ADIADA até existir critério real de ativação (segundo dev
  de fato simultâneo no mesmo projeto).
- **`guard.ts` best-effort** — não é lacuna a fechar, ver Consequências.

## Consequências

**O que dói, e não é resolvido por este ADR:** `ALTER TYPE ... ADD VALUE`
tem restrições transacionais em várias versões do PostgreSQL (não pode ser
usado na mesma transação em que o valor novo é referenciado). A migration
que introduzir o terceiro valor do enum precisa tratar isso explicitamente
(dois passos, ou recriar o tipo) — registrado aqui como risco técnico para
a sessão de implementação, não resolvido neste documento.

**O que fica DECLARADO como invariante, não como lacuna:**
`apps/runner/src/guard.ts` continua sendo, e continuará sendo, uma checagem
LÉXICA best-effort — vulnerável a TOCTOU e a symlink criado depois da
checagem, sem sandbox, sem usuário separado, sem limite técnico real. Isto
já estava declarado no ADR 0103; este ADR REAFIRMA explicitamente, porque
`execution_mode = 'runner'` deixa de ser um bônus condicional (modo `local`
+ runner conectado por acaso) e passa a ser um caminho de PRIMEIRA CLASSE
na criação do projeto — e um caminho de primeira classe corre o risco de
ser lido, por alguém que não acompanhou o ADR 0103, como uma promessa de
isolamento que nunca existiu. A fronteira de segurança real do runner
continua sendo, só: autenticação (o CLI se identifica com o token da conta
do usuário) + o pipeline de aprovação de sempre (todo comando de agente
nasce `proposed_action`, tetos absolutos do ADR 0102 incluídos) +
consentimento do usuário em rodar o binário na própria máquina.

**O que este ADR NÃO faz:**

- Não implementa nenhuma linha de código, migration, rota ou UI — é decisão
  registrada, a sessão de implementação executa sobre `origin/dev`.
- Não desenha o mecanismo exato do estado `unverified`/`verified` (evento,
  rota, onde grava) — só declara que ele existe e o critério de promoção.
- Não implementa nenhuma conversão entre valores de `execution_mode` — só
  declara que todas as direções passam a ser permitidas.
- Não muda a fronteira de efeito externo (RN-106/RN-418): `git push`,
  abertura de PR e deploy continuam `require_approval` incondicional,
  dentro ou fora do escopo, em qualquer `execution_mode`.
- Não muda a política de escopo de caminho nem o allowlist do terminal
  (ADR 0055) — o que muda é só onde/quando o disco é verificado na
  criação do projeto.
