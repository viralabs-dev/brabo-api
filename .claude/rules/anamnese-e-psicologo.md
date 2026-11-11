---
paths:
  - "src/domain/anamnese/**"
  - "src/domain/psychologist/**"
---

> Regra de CAMINHO: carregada só quando a sessão lê arquivo que casa com `paths:`. Saiu do `CLAUDE.md` por causa do teto de 40 mil caracteres; texto INTEGRAL de `.claude/contexto/estado-atual.md` (`brabo-legacy`, `dev` @ `1586158973`). Edite AQUI.

- Psicólogo PAUSADO desde 2026-08-10 (`PSYCHOLOGIST_ENABLED=false`),
  aguardando spec; Staff dormente para disparo automático (acionável manual —
  nenhum código o dispara, nem a Anamnese)

- A Anamnese foi RELIGADA em 2026-10-01 por decisão do dono (RN-680, ADR
  0196): `ANAMNESE_ENABLED` volta ao default `true` no `runtime.exs` e nos
  três composes (`START_ANAMNESE` não mudou: `false` só no de produção,
  divergência já declarada), com duas correções que são regra. (1) A rodada
  NÃO roda sem SUJEITO elegível — membro EFETIVO do projeto
  (`listEffectiveMembers`, a régua da RN-471; criar projeto não grava
  `project_members`, e era por isso que toda rodada do uso real de 29/09
  terminava paga em "nenhum membro elegível"), fora do opt-out, com
  interação PRÓPRIA na janela (`Engine.Anamnese.Elegibilidade`, antes da
  triagem; desde a RN-756 só conta interação de CONTEÚDO TÉCNICO — mensagem
  escrita, resposta estruturada, recusa com motivo —, nunca aprovação/handoff; nem a fila de hipóteses a atravessa). Sem sujeito: nenhuma
  chamada ao LLM nem ao RAG, motivo nomeado no log e, só na rodada pedida à
  mão, `anamnese.run_skipped`. (2) A hipótese que a PRÓPRIA pessoa aceitou
  (quem aceita é o autor da sessão) vira `FatoDoPerfil` no grafo, traduzido
  de `psychologist.hypothesis_accepted` pelo MESMO `GraphEventTranslator`, e
  entra no turno dos agentes que conversam com ela como mensagem `system`
  EFÊMERA (`Engine.Harness.PerfilDoAutor`, o caminho do idioma da RN-622;
  lida por `QueryUserContextUseCase`, escopada ao projeto, 5 fatos, teto de
  2 000 caracteres). Aceite de terceiro e recusa ficam só registrados.
  Desde a RN-716 (AT-376) a Anamnese não grava nível sobre o que não
  observou: perfil cuja evidência não inclui evento da PRÓPRIA pessoa, ou só
  tem cliques de aprovação (`proposed_action.approved`, `handoff.accepted`,
  `readiness.confirmed`), é recusado pela api como "não observado", sem
  `profile_updated`. A regra é de CÓDIGO (`validateProficiencyBatch`), não só
  de prompt; não a afrouxe para o lote passar. O que a pessoa faz para
  reparar falha de agente não é traço dela, e a Anamnese NÃO o registra: a
  RN-717 (ADR 0205, `anamnese.agent_deviation`) foi REVOGADA pela RN-1076
  (ADR 0291, AT-898). Não recrie o evento nem a ferramenta
  `report_agent_deviation`; a falha técnica da plataforma é assunto do TP-01
  (ver o Psicólogo, abaixo).
  Desde a RN-722 (decisões do dono de 02/10) a rodada que avalia a janela e
  encerra sem perfil a FECHA (`anamnese_runs` com zero perfis) — antes ela
  rodava paga a cada 15 min sobre a mesma janela, para sempre (~US$ 8,90/dia
  medidos); os eventos da própria Anamnese e os de sistema ficam fora da
  janela e da contagem; sujeito exige 5+ interações próprias NOVAS e o projeto
  tem no máximo 4 rodadas pagas por dia UTC — abaixo disso, nem LLM nem RAG.

- Psicólogo PAUSADO desde 2026-08-10 (`PSYCHOLOGIST_ENABLED=false`),
  aguardando spec — e a Anamnese esteve pausada junto até a RN-680. A pausa do
  Psicólogo segue valendo e a decisão de produto NÃO mudou — o que mudou na
  RN-540 é que ela passou a ser REVERSÍVEL de verdade: as duas flags não estavam mapeadas no `environment:`
  do serviço `engine` de compose NENHUM, o Compose não repassa o ambiente do
  host, e `ANAMNESE_ENABLED=true` no `.env` era inerte — `runtime.exs` caía no
  default `"false"` em silêncio, enquanto TRÊS lugares (os docblocks dos dois
  workers e `docs/reference/configuration.md`) prometiam que "ligar de volta é
  `X=true` e reiniciar". Medido no container: `[true] [] []`. As oito flags
  BOOLEANAS do `runtime.exs` estão nos TRÊS composes agora (o de instalação
  desde a AT-202), cada uma com o MESMO default do código salvo as duas chaves
  de boot que PRODUÇÃO desliga de propósito, DECLARADAS no spec, e
  `scripts/ci/flags-do-engine-no-compose.spec.ts` DERIVA a lista e reprova a
  próxima que faltar. A INSTALAÇÃO tinha a mesma divergência por CÓPIA e deixou
  de ter (AT-219): ali `START_OUTBOX_DRAIN=false` deixava o outbox sem
  consumidor nenhum — sessão encerrada não parava, dev agent esperando
  decisão/gate/container nunca acordava. Não "uniformize" produção e
  instalação em nenhum dos sentidos. As duas chaves de boot ligadas não gastam
  token com as flags de PRODUTO desligadas: o `kickoff/0` da Anamnese não
  agenda job, e o drain não enfileira o Psicólogo. E ligar a Anamnese periódica
  são DUAS variáveis: `START_ANAMNESE` é a chave de BOOT (decide se o tick é
  agendado) e `ANAMNESE_ENABLED` é a flag de PRODUTO (decide se uma rodada nova
  pode acontecer) — o Psicólogo tem só a segunda, porque o gatilho automático
  dele é o fechamento de sessão, não um tick. `deploy/k8s/` fica de fora por
  COERÊNCIA e não omissão: um Deployment/ConfigMap não intercepta nada, e o
  `brabo-config` nunca carregou nenhuma destas variáveis; Staff dormente para
  disparo automático (acionável manual)

- O Psicólogo olha o PRODUTO do usuário (RN-1076, ADR 0291, AT-898). Cada item
  do lote traz `escopo`: `produto` vira hipótese em Percepções, como antes;
  `plataforma` (agente ocioso, teto, worktree, validador) NUNCA vira hipótese.
  Em projeto marcado como teste (`projects.sessao_de_teste`, ligada por
  `pnpm projeto:marcar-teste <projectId>`, sem tela) o item de plataforma vira
  `psychologist.platform_signal` no log da sessão; em qualquer outro projeto é
  descartado sem evento. O lote INTEIRO passa pela validação de evidência
  (id inválido em item de plataforma reprova tudo), lote vazio é válido e a
  `terminationAnalysis` só é exigida em sessão de teste. O
  `psychologist.analysis_completed` traz `hypothesisCount` e
  `platformSignalCount`. O sinal NÃO entra em `EVENTOS_DO_LOG_PROJETAVEIS`
  (fora do grafo e da fila da Anamnese; o spec
  `sinal-de-plataforma-fora-do-grafo.spec.ts` guarda isso) — não o projete no
  `GraphEventTranslator`. Hipóteses e eventos antigos ficam como estão, sem
  migração.
