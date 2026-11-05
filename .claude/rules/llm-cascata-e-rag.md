---
paths:
  - "src/domain/llm/**"
  - "src/infrastructure/llm/**"
  - "src/domain/rag/**"
---

> Regra de CAMINHO: carregada só quando a sessão lê arquivo que casa com `paths:`. Saiu do `CLAUDE.md` por causa do teto de 40 mil caracteres; texto INTEGRAL de `.claude/contexto/convencoes-agentes-e-telas.md e estado-atual.md` (`brabo-legacy`, `dev` @ `1586158973`). Edite AQUI.

- Tela NUNCA repete o enum do banco como se fosse resposta, e não colapsa
  dois estados por eles compartilharem um valor (RN-470). `origin: 'agent'`
  da cascata de modelo quer dizer DUAS coisas — o agente tem binding próprio,
  ou a cascata pousou em `workspace` e `herdarModeloDeStart` trocou o valor
  pelo do Criativo. A api está certa em devolver `agent` nos dois (o valor
  veio mesmo de um agente): quem separa é a TELA, e ela separa mostrando a
  cascata inteira como cadeia — `workspace › projeto › área › agente`, com
  `vigente`/`definido`/`vazio`/`pulado` por nó, o nível que a cascata alcançou
  marcado como definido-e-não-vigente quando o Criativo entrou, e um nó extra
  nomeando o Criativo. A derivação é do CLIENTE, sem endpoint novo; o que ela
  NÃO consegue provar (agente com linha própria igual à do Criativo) fica
  declarado, e a ação que só importa nesse caso continua acionável. Vazio tem
  texto próprio e vazios diferentes têm textos diferentes — um traço que serve
  a três significados não é neutro, é a tela recusando nomear o que sabe.

- O contrato de LLMProvider tem DUAS operações opcionais, e as duas seguem a
  mesma regra de dois lados: `listModels` (Fase 9c) e `embed` (ADR 0075,
  RN-189..191). Embedding é LOTE e devolve **um vetor por entrada ou erro** —
  nunca lista mais curta, porque a ordem é o único vínculo entre entrada e
  vetor e uma resposta parcial é indetectável depois. O erro LANÇA normalizado
  por `code` em vez de virar chunk: não há turno em andamento cujo gasto
  precise sobreviver. A capability tem duas camadas como as outras, com uma
  diferença que precisou ser nomeada: tool calling é GRADIENTE (modelo sem
  ferramenta ainda conversa) e embedding é EXCLUSÃO — modelo de chat não
  vetoriza e modelo de embedding não conversa (RN-190), conjuntos disjuntos.
  Só o `ollama` declara `embeddings: true`, provado contra o daemon real; os
  outros oito degradam com `false` (RN-191), e virar essa flag exige smoke com
  credencial, nunca leitura de doc. O gasto de embedding NÃO passa pelo
  metering ainda — corte declarado do ADR 0075, porque `token_usage.session_id`
  é `NOT NULL` e indexar repositório não acontece dentro de sessão. A ÚNICA
  exceção é a checagem de duplicata semântica (ADR 0198, RN-681), que roda na
  emissão de história/regra, dentro de sessão, e grava linha própria (ator
  `system`/`duplicata-semantica`); o `uso` que `RagEmbeddingService` devolve é
  ignorado pela indexação e pela busca de propósito — não o "aproveite" lá.

- A capability `routingPreference` (ADR 0166, RN-583) é `true` SÓ no
  OpenRouter desde 2026-09-29 (AT-158), PROVADA:
  `openrouter-provider.roteamento.smoke.spec.ts` rodou com credencial real e o
  critério mudou o upstream que serviu (`meta-llama/llama-3.3-70b-instruct`:
  `price` → DeepInfra, `throughput` → Groq). A prova é a DIFERENÇA entre
  critérios, não o aceite do campo — o modelo antigo do smoke devolvia o mesmo
  upstream para todos e não provava nada. Os outros oito seguem `false` e,
  para eles, a feature segue DORMENTE (422 na rota). Ligar outro provider exige
  o smoke equivalente com credencial e a saída citada no PR — doc do hub não é
  prova. Não "ligue de passagem"

- A capability `stickySession` (ADR 0221, RN-907, AT-580) é `true` SÓ no
  OpenRouter desde 2026-10-21, PROVADA: `openrouter-provider.sessao.smoke.spec.ts`
  rodou com credencial real e, com `session_id`, 6 de 6 chamadas caíram no mesmo
  upstream (sem ele, 4 upstreams em 6). Os outros oito seguem `false`; ligá-los
  exige o smoke equivalente. `provider.order`/`allow_fallbacks` seguem fora

- A capability `promptCaching` (RN-892, AT-543) é `true` no OpenRouter
  desde 2026-10-15, PROVADA: `openrouter-provider.cache.smoke.spec.ts` rodou
  com credencial real e a segunda chamada a `anthropic/claude-haiku-5.5`
  voltou com `cached_input_tokens=8011`. O hook segue marcando só
  `anthropic/*`. Na Anthropic direta também é `true` (RN-1008, AT-744):
  `system` em dois blocos (ponto no prefixo), ponto na última `user`, usage
  somando `input + leitura + escrita` e custo pelas 4 parcelas × tabela do
  fabricante; prova em `anthropic-provider.cache.smoke.spec.ts`. Os outros
  sete providers seguem `false`, e ligá-los exige o smoke equivalente

- Gasto de embedding fora do metering (corte declarado do ADR 0075), salvo a
  checagem de duplicata semântica (ADR 0198, RN-681), que é linha própria

- O limiar da duplicata semântica (0,80, RN-681) é PONTO DE PARTIDA NÃO
  calibrado: os vetores reais dos pares de calibração não puderam ser gravados
  (registry do Ollama e Hugging Face bloqueados no ambiente). Gravar é
  `apps/api/scripts/gravar-vetores-de-duplicata.ts` com o Ollama de pé; a prova
  (`limiar-de-duplicata.calibracao.spec.ts`) PULA até lá. Não mexa no número
  sem gravar, e se a gravação não separar os pares, reveja os pares ou o texto
  comparado — nunca afrouxe o teste

- Chunking do RAG (1200 caracteres/150 de sobreposição) e pesos da busca
  híbrida (0.6/0.4, limiar 0.2) seguem sendo PONTO DE PARTIDA — ainda NÃO
  calibrados (ADR 0080). O que mudou desde a Etapa 1 é que agora dá para
  calibrar: a busca deixa rastro (`rag_searches`/`rag_feedback`, RN-479/480) e
  `pnpm --filter api medir:rag` lê esse rastro. O que mudou desde a Etapa 2
  (ADR 0132) é que existe um corpo de 17 perguntas medindo ACERTO de
  retrieval — mas é um corpus CURADO (22 arquivos, não os 130+ ADRs reais) e
  mede se o arquivo certo aparece, não se os PESOS estão certos; mexer nos
  quatro números antes de acumular medição de verdade continuaria destruindo
  a linha de base que os dois instrumentos juntos existem para criar (Etapa 5
  é a única que calibra, e só se a medição comprovar que ajuda). O que mudou
  desde a Etapa 3 (ADR 0138, RN-498) é só ONDE o golden-set roda — em CI
  agora, agendado, além de manual — nunca O QUE ele mede nem o corpus que
  usa; corpus curado e calibração continuam exatamente como estavam

- Golden-set de acerto do RAG (ADR 0132, RN-490) — a metade "nunca em CI"
  FECHOU na Etapa 3 (ADR 0138, RN-498): `.github/workflows/golden-set-rag.yml`
  roda `mix golden_set.rag` de verdade, agendado (o gate `rag-acertivo`
  continua `warn`, agora por cadência, não por falta de CI). O que segue
  pendência de dono humano é só a outra metade: medido de verdade (17/17,
  duas rodadas manuais antes disso, determinístico), piso gravado em
  `floor.json` — mas contra um corpus CURADO (22 arquivos), não os 130+
  ADRs reais do produto; ampliar o corpus é decisão de custo de embedding
  numa rodada manual, não escolhida aqui

**Backlog:** `docs/explanation/backlog.md` é a triagem da FASE 13c e é
HISTÓRICA — não a leia como fila viva. Medição de 2026-09-12: pelo menos DOZE
itens que ela ainda apresenta como abertos já não reproduzem (o isolamento do
executor, o schema por agregado, o golden-set do gate semântico, o backup de
`git_local_repos`, o compose de instalação, "FASE 29 é planning-only", o
Dependabot, duas lacunas do runbook, a severidade dos alertas, e mais). O
defeito é de CADÊNCIA e não de conteúdo: fases foram fechadas sem ninguém
voltar ali marcar. A fila viva é o backlog do mantenedor; este arquivo guarda
o RACIOCÍNIO da triagem, que continua valendo.
