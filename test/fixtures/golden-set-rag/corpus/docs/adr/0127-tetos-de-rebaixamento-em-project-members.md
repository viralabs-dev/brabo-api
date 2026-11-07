# 0127 — Dois tetos de rebaixamento em `project_members`, e a sobreposição fica

## Context

`ResolveEffectiveRoleUseCase.forProject` é, desde a Fase 1,
`projectRole ?? workspaceRole`: existindo linha em `project_members`, ela
**vence**, sem comparar com o papel de workspace. A sobreposição vale nos DOIS
sentidos — sobe e desce.

Isso foi descoberto pela revisão da #444, que fechou o gate de papel da seção de
Membros, e está registrado na
[RN-471](../business-rules.md#rn-471). O achado tem duas metades. A primeira é
documental: QUATRO lugares prometiam o contrário — "the EFFECTIVE role is the
higher of this one and what the person already has in the workspace",
"associating someone as `viewer` here doesn't downgrade a workspace `owner`" —
três descrições de OpenAPI e um comentário no `apps/web/src/lib/roles.ts`. A
RN-471 corrigiu o do web (era o pior: morava no módulo que exporta `roleAtLeast`
e `ROLE_ORDER`, ou seja, no código que a próxima pessoa desta família abre antes
de qualquer outra coisa) e DECLAROU as três da api como não corrigidas, por
serem mudança de contrato.

A segunda metade não estava guardada em lugar nenhum, e é o motivo deste ADR:
com a sobreposição valendo para baixo, `AddProjectMemberUseCase` era um
passthrough de uma linha para o upsert do repositório e `RemoveProjectMemberUseCase`
só checava se o projeto existia. Nenhum dos dois olhava para QUEM é o alvo nem
para a relação entre ator e alvo. Duas consequências alcançáveis por qualquer
`maintainer`, hoje:

1. **rebaixar o `owner` do workspace.** Um `maintainer` grava `viewer` para o
   dono num projeto e o dono perde o próprio projeto — a leitura do dashboard,
   as decisões, tudo. Restaurar exige `maintainer`, que o dono acabou de perder
   naquele escopo;
2. **auto-rebaixamento irreversível.** Um `maintainer` se grava como `viewer` e
   não consegue desfazer, porque desfazer é a mesma rota, que pede `maintainer`.
   Não há caminho de volta pela tela.

Nada disto é escalação de privilégio — ninguém ganha papel que não tinha. É
perda de acesso, e a diferença importa: um `maintainer` já podia fazer estrago
no projeto, mas não podia produzir um estado do qual NINGUÉM sai sem ir ao
banco.

O caminho óbvio seria fazer `forProject` devolver "o maior dos dois" e apagar o
problema na raiz, alinhando o código às três descrições em vez do contrário.
Foi considerado e RECUSADO: restringir alguém num projeto sensível — um
`developer` de workspace que vira `viewer` no projeto X — é capacidade
deliberada do produto, e é a única forma que existe de conter acesso por
projeto. "O maior dos dois" a elimina, e o
`resolve-effective-role.use-case.spec.ts` já fixa a metade de subir
("papel de projeto sobrepõe o de workspace") desde sempre.

## Decision

**A sobreposição fica nos dois sentidos, e os dois movimentos perigosos passam a
ser recusados.** `forProject` NÃO muda: continua `projectRole ?? workspaceRole`,
e continua sendo a única composição desse papel no sistema.

**Teto 1 — ninguém rebaixa quem é `owner` do workspace.** O papel pedido para
alguém cujo papel de workspace é `owner` tem de ser `owner`; qualquer coisa
abaixo é 403. Gravar `owner` de projeto para quem já é `owner` de workspace é
redundante e passa — só o rebaixamento é recusado.

O `owner` é lido de **`workspace_members.role`**, nunca de `workspaces.created_by`.
Os dois existem em `db/schema/iam.ts` e não são a mesma coisa. `created_by` é um
fato histórico: quem criou o workspace. É o `role` que a autorização usa em TODO
o resto do sistema — `ResolveEffectiveRoleUseCase.forWorkspace` é
`workspaces.findMemberRole`, e `created_by` não aparece em nenhum caminho de
autorização (aparece em `get-credential-spend.use-case.ts`, para saber de quem é
a chave de LLM que se gasta, que é outra pergunta). Um teto que lesse
`created_by` protegeria a pessoa errada em dois casos concretos e opostos: o
criador que já transferiu a propriedade e hoje é `developer` ficaria blindado
sem sê-lo, e o `owner` corrente que não criou nada — o caso normal de workspace
com mais de um dono, e o de propriedade transferida — ficaria desprotegido, que
é exatamente o buraco que o teto existe para fechar.

**Teto 2 — ninguém rebaixa a SI MESMO.** Se o alvo é o próprio chamador e o
papel pedido é menor que o papel efetivo que ele tem HOJE no projeto, é 403.

A formulação é essa, sem limiar. A alternativa considerada era "não se
auto-rebaixar **abaixo de `maintainer`**", com o argumento de que `maintainer` é
o papel que desfaz. As duas recusam o movimento perigoso, mas a com limiar é uma
regra de domínio que copia um número de um `@RequireRole` de controller:
envelhece calada no dia em que a rota mudar de mínimo, e não se enuncia sem
explicar de onde veio o `maintainer`. "Ninguém rebaixa a si mesmo" é uma
cláusula, não tem número para envelhecer, e é a MESMA forma do teto 1 — quem,
não quanto. O preço é um movimento inofensivo que cai junto: um `owner` se
pondo como `maintainer` no próprio projeto seria reversível, e passa a ser
recusado. Continua alcançável por outro `maintainer`, e o custo de enunciar a
regra com exceção é maior que o de perder o movimento. **Subir** o próprio papel
não é rebaixamento e não é tocado aqui.

**Onde os tetos moram: no caso de uso, com a regra no domínio.** Não no
`RolesGuard`. O guard responde outra pergunta — autoriza o CHAMADOR contra o
`@RequireRole` da rota — e não vê corpo (`dto.role`) nem alvo (`dto.userId`),
enquanto os dois tetos são sobre o ALVO e sobre a relação ator↔alvo. Um guard
que precisasse do corpo teria de conhecer o DTO de cada rota, que é a fronteira
que ele existe para não cruzar.

A FORMA segue o precedente que o repositório já tem para teto absoluto:
`domain/actions/decide.ts` (RN-154, e a RN-418 que revisou a RN-106) — função
pura, no domínio, mensagem ao lado da condição, sem chave de configuração e sem
"sempre permitir". O novo `apps/api/src/domain/iam/tetos-de-rebaixamento.ts` é
essa forma aplicada aqui, e `AddProjectMemberUseCase` a chama antes de escrever.
O que NÃO se transporta do precedente é o desfecho: em `decide.ts` o teto vira
`require_approval` sobre uma `proposed_action` de agente, porque existe fila de
aprovação humana do outro lado. Aqui a chamada já É humana e síncrona, não há
fila para onde mandá-la, e o desfecho é a recusa.

**Status: 403 nos dois.** É recusa de AUTORIZAÇÃO — o chamador tem o papel da
rota e não tem autoridade para este movimento específico. Não é 409, porque não
é conflito com um estado que passa (esperar não muda nada); não é 400, porque o
corpo é válido e o mesmo corpo com outro alvo passaria. `ForbiddenException` com
mensagem própria é o que os outros usos de política na api já fazem
(`ActivateAgentUseCase`, `CreateSocketTicketUseCase`, `RegisterUseCase`), e a
mensagem chega à tela: a #444 pôs `try/catch` com `mensagemDaApi` nas duas ações
que falhavam caladas.

**As três descrições de OpenAPI que a RN-471 declarou passam a descrever o que o
código faz** — as de `POST :projectId/members`, de `AddMemberDto.role` e o
resumo de `GET :projectId/members`, que prometia "includes whoever inherits
access from the workspace" enquanto `listMembers` é um `innerJoin` em
`project_members`. `openapi.json` e `api-types.generated.ts` saem do gerador.

**O lado web fica FORA desta PR**, e não por tamanho. A tela consegue calcular o
teto 2 sozinha (`userIdDaSessao()` e o papel efetivo já estão lá desde a #444),
mas **não** consegue calcular o teto 1: `listProjectMembers` devolve o papel da
LINHA DE PROJETO, e o papel de WORKSPACE do alvo não está ao alcance de consulta
nenhuma do cliente. Desabilitar metade das opções produziria um `Select` honesto
sobre uma recusa e caladamente errado sobre a outra — a segunda fonte de papel
inventada na tela contra a qual a própria RN-471 escreve. Enquanto isso, a
recusa APARECE: `handleRoleChange` já mostra `mensagemDaApi(erro, …)` num toast,
e é a frase da api que explica QUAL teto bateu.

## Consequences

**A sobreposição continua sendo faca de dois gumes, e é o que se comprou.**
Nenhum destes dois tetos torna `projectRole ?? workspaceRole` seguro em geral;
eles recusam dois movimentos nomeados. Um `maintainer` continua podendo rebaixar
qualquer pessoa que NÃO seja `owner` de workspace e que não seja ele mesmo —
inclusive outro `maintainer`, inclusive de forma que a vítima não desfaz. Isso é
a capacidade, não um descuido: é a mesma mecânica que restringe um `developer` a
`viewer` num projeto sensível, e não há como manter uma sem a outra. O que mudou
é que o estado do qual NINGUÉM sai (dono fora do próprio projeto; único
`maintainer` se apagando) deixou de ser alcançável.

**Segue possível, com nome:**

- rebaixar outro `maintainer` que não é `owner` de workspace, sem consentimento
  dele e sem volta pela mão dele;
- **auto-rebaixamento pela REMOÇÃO.** `RemoveProjectMemberUseCase` NÃO ganhou
  teto, e isso é um movimento a mais, fora dos dois escolhidos. Remover a
  própria linha derruba o efetivo para o papel de workspace: quando o workspace
  segura (`maintainer` lá), é benigno e é justamente como alguém sai da lista;
  quando NÃO segura — o `maintainer` cuja autoridade vinha da linha de projeto,
  com `viewer` no workspace — é auto-rebaixamento irreversível pela outra porta.
  A premissa de que "a remoção é sempre benigna" é falsa, e fica escrita aqui
  para não ser redescoberta. Os dois casos estão FIXADOS em teste
  (`tetos-de-rebaixamento.use-case.spec.ts`), inclusive o que segue aberto, para
  a próxima pessoa saber que é decisão e não esquecimento. Fechá-lo custa a
  assinatura de `RemoveProjectMemberUseCase.execute`, que hoje é chamada por
  `list-projects-and-members.use-case.spec.ts` com dois argumentos;
- **auto-PROMOÇÃO.** Um `maintainer` pode se gravar como `owner` do projeto.
  Já era possível antes deste ADR e continua sendo; os tetos são sobre descer, e
  abrir a questão de subir aqui teria mudado, de passagem, uma capacidade que
  ninguém pediu para mudar;
- rebaixar o `owner` do workspace **no workspace**. O teto 1 é sobre
  `project_members`. `POST workspaces/:workspaceId/members` continua um upsert
  sem teto nenhum — mesma classe de defeito, escopo acima, não endereçado aqui.

**A tela oferece o que a api recusa, por enquanto.** É exatamente o defeito que
as últimas PRs desta família fecharam, e ele volta por uma PR, de propósito:
metade do gate é impossível no cliente hoje (ver Decision). A PR do web precisa
decidir entre expor o papel de workspace do alvo em `GET :projectId/members` —
mudança de contrato, e a RN-471 já registrou que a rota promete um `innerJoin`
que não faz — e apagar só o que ela sabe. Até lá, a recusa é dita pelo toast,
com a frase da api.

**Um 500 virou 404.** `AddProjectMemberUseCase` passou a chamar
`projects.findById` (precisa do `workspaceId` para ler o papel do alvo) e lança
`NotFoundException` quando o projeto não existe, como `ListProjectMembersUseCase`
e `RemoveProjectMemberUseCase` já faziam. Pelo HTTP é inalcançável — o
`RolesGuard` recusa antes com 403 —, mas o caso de uso deixou de presumir o
chamador.

**Duas consultas a mais por associação.** `findById`, `findMemberRole` no
workspace e o `forProject` do ator (que refaz o `findById`). É uma rota de
administração, chamada uma vez por convite, e a alternativa — reaproveitar o
`request.effectiveRole` que o guard já calculou — amarraria o caso de uso ao
estado do guard, que é o acoplamento que a escolha de ONDE o teto mora existe
para evitar.

**As três descrições da OpenAPI mudam sem mudar nenhuma resposta.** Quem
integrava lendo a promessa antiga ("higher of") já estava errado desde a Fase 1;
o contrato gerado agora descreve o comportamento real, e o `403` dos dois tetos
é novo de verdade para quem chama a rota.
