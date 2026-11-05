# ADR 0080 — Busca híbrida: pesos, limiar e o que é citação

- **Status:** aceito
- **Data:** 2026-08-16
- **Contexto anterior:** [ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)
  (a tabela `chunks`, com vetor e `tsvector` na mesma linha — fundação sem
  pipeline nem busca), [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)
  (`LLMProvider.embed?`, capability provada só contra o Ollama)

## Contexto

O ADR 0079 deixou a tabela pronta e vazia: nenhum pipeline escreve nela,
nenhuma busca lê dela. Esta onda (PROGRAMA 28, Onda 4, frente G2) precisava
resolver quatro perguntas em aberto, e as quatro são estruturais — decisão
de produto, não detalhe de implementação:

1. **De onde vem o texto que vira chunk**, para os três escopos honestos do
   ADR 0079 (`docs`, `adr`, `session`)?
2. **Como recortar** um documento/mensagem em pedaços — tamanho, sobreposição
   — sem um número arbitrário?
3. **O que fazer quando o provider de embedding não responde?** O pipeline
   não pode fingir que indexou por completo quando só indexou a metade
   léxica.
4. **Como combinar** o sinal vetorial (pgvector) com o léxico (`tsvector`)
   numa busca só, com que peso e que corte — e **o que devolver** como
   citação, já que é esse contrato que o Chat RAG (Onda 5, tela ainda não
   construída) vai consumir sem poder adivinhar forma.

## Decisão

### 1. Origem do texto: o repositório do PRÓPRIO projeto, e o event log da sessão

`docs`/`adr` são indexados a partir do repositório GIT do projeto sendo
indexado — via `ReadProjectCodeUseCase`, a MESMA superfície que a aba Code
usa (mesma resolução de credencial do owner, RN-058/082; mesmo portão de
container, RN-105; mesma checagem de caminho, RN-095; mesmo cache). Não é a
documentação do Brabo enquanto produto: é a convenção `docs/`/`docs/adr/`
que cada projeto GERENCIADO pode ter no próprio repositório. Reindexar sem
duplicar a varredura da árvore importava mais que separar os dois escopos
em dois casos de uso — `IndexProjectDocsUseCase` cobre os dois, distinguindo
por PREFIXO de caminho (`docs/adr/` → `adr`, resto → `docs`).

`session` é indexado a partir dos DOIS tipos de evento que formam uma
conversa: `chat.message` (o humano) e `agent.response` (o agente). O resto
do event log (`tool.call`, `agent.status`, `tool.result`, eventos de gate)
fica de fora — é mecanismo, não conhecimento citável. Indexar um `tool.call`
faria a busca devolver um payload JSON como se fosse prosa; indexar
`agent.error` citaria uma falha como se fosse assunto da sessão. Cada chunk
de sessão guarda `metadata.sourceRef` com o id do evento de ORIGEM — o mesmo
id que `GetSessionEventUseCase` já resolve — para a citação poder navegar de
volta ao ponto exato da conversa.

### 2. Chunking: 1200 caracteres, 150 de sobreposição, por PARÁGRAFO/quebra

`CHUNK_TARGET_CHARS = 1200` (~300 tokens em português) mira um trecho grande
o bastante para carregar uma ideia completa — o que um vetor de embedding
precisa para não diluir o sentido entre tópicos não relacionados — e pequeno
o bastante para virar uma citação que se lê em segundos, não um documento
inteiro. `CHUNK_OVERLAP_CHARS = 150` (12,5% do alvo) existe porque um corte
exato no meio de uma frase faz o pedaço seguinte perder o antecedente dela.

Os dois números são **ponto de partida ajustável, não ciência**: não existe,
ainda, um corpo de perguntas reais rodado contra este índice para calibrar
tamanho ótimo de chunk contra qualidade de recuperação — este programa não
produziu esse dado, e inventá-lo seria fingir precisão que não existe (a
mesma classe de erro que o ADR 0042 recusa para nota de modelo).

O corte prefere a quebra de PARÁGRAFO mais próxima do alvo (`\n\n`), depois a
de PALAVRA (espaço), e só corta no meio de uma palavra se nenhuma das duas
existir numa janela de 200 caracteres — Markdown com Markdown quebrado no
meio de uma tabela ainda é melhor que uma citação que corta uma frase ao
meio. Documentos Markdown (`docs`/`adr`) são divididos por HEADING primeiro
(preservando a trilha `headingPath`, a parte de "seção" na citação
"arquivo + seção"), e só então recortados por tamanho DENTRO de cada seção.

Contar TOKEN em vez de caractere exigiria o tokenizador do próprio modelo de
embedding, que `nomic-embed-text` não expõe localmente (diferente do
`GptTokenizerEstimator` que o `chat` já usa, calibrado para modelos de
CHAT). Caractere com preferência por quebra limpa é uma aproximação honesta.

### 3. Falha do provider: indexa léxico, declara a lacuna — nunca finge completo

O modelo/provider de embedding são FIXOS por constante
(`RAG_EMBEDDING_MODEL = 'nomic-embed-text'`, `RAG_EMBEDDING_PROVIDER =
'ollama'`), não resolvidos por catálogo: `chunks.embedding` é `vector(768)`,
a dimensão real e DOCUMENTADA desse modelo (RN-222), e não existe ainda
coluna persistida dizendo "qual modelo é de embedding" — o ADR 0075 deixou
isso como trabalho futuro, e esta onda não tinha slot de migração para
resolver (a única migração desta onda, `0046`, é da frente F1, para
`project_containers`).

Quando `ollama` não responde — daemon fora do ar, timeout, modelo não
puxado — `RagEmbeddingService` **não lança para o chamador tratar chunk a
chunk**: devolve `available: false` e `null` para cada vetor pedido. O
pipeline de indexação grava os chunks MESMO ASSIM, com `embedding: null` —
`search_vector` é `GENERATED ALWAYS AS` e não depende de provider nenhum
(ADR 0079), então a metade léxica continua disponível mesmo com a semântica
fora do ar. A alternativa — falhar a indexação inteira porque metade de um
sinal faltou — jogaria fora a metade que funcionou. O relatório de
indexação (`embedding: { available, embedded, skipped, reason }`) declara a
lacuna; nada no retorno diz "indexação completa" quando ela não foi.

A mesma degradação vale na BUSCA: se a consulta não puder ser vetorizada, a
busca roda só com o sinal léxico e `vectorAvailable: false` avisa — nunca
finge ter rodado o híbrido completo.

### 4. Busca híbrida: duas consultas independentes, fusão por soma ponderada

Vetor e léxico são **duas consultas separadas** contra `chunks`
(`ChunkRepository.searchByVector`/`searchByLexicalQuery`), não uma só com
JOIN — cada uma aproveita o índice feito para ela (HNSW para cosseno, GIN
para `ts_rank`), a mesma razão de design que levou o ADR 0079 a pôr as duas
colunas na MESMA linha (para não perder a fusão) mas não obriga a MESMA
consulta (para não perder o índice certo). O port devolve candidatos brutos;
o caso de uso (`HybridSearchUseCase`) funde, pesa e corta — mesma fronteira
que já separa `ChunkRepository` (guarda dado) de quem decide o que fazer com
ele (RN-226).

**Pesos: 0.6 vetorial, 0.4 léxico.** `ts_rank` normalizado (bit 32,
`rank/(rank+1)`) raramente passa de ~0.3 mesmo num casamento forte, enquanto
similaridade de cosseno de um par genuinamente relevante costuma ficar entre
0.5 e 0.85 — as duas escalas NÃO são comparáveis por natureza. O peso maior
do lado vetorial reconhece isso sem apagar o léxico: um chunk só-léxico
ainda pode passar do limiar sozinho (`0.4 * 0.3 = 0.12`, abaixo do limiar —
então na prática um casamento léxico muito forte sozinho ainda não basta, o
que é intencional: texto que só bate uma palavra em comum não deveria virar
citação sem apoio nenhum de sentido).

**Limiar: 0.2.** Abaixo dele, "achamos algo fraco" e "não achamos nada"
ficam indistinguíveis para quem lê a resposta — uma citação fraca
apresentada como se fosse forte é pior que nenhuma citação.

**Nenhum dos quatro números (pesos, limiar, tamanho de chunk, sobreposição)
vem de calibração com dado real de qualidade de busca.** Não há, ainda, um
corpo de perguntas reais rodado contra este índice — o Chat RAG em si
(Onda 5) ainda não existe como tela. São ponto de partida, documentados como
tal, com o argumento de cada escolha escrito para poderem ser revistos com
dado depois, não recalculados de cabeça.

### O que conta como citação

O contrato de retorno (`HybridSearchHit`) é: `chunkId`, `content`, `score`
combinado, `vectorScore`/`lexicalScore` (cada um `null` quando aquele sinal
não achou o chunk — não zero, que confundiria "não achou" com "achou e a
similaridade é zero"), `scope`, e `origin` — uma união discriminada por
`kind`: `{ kind: 'file', sourcePath, headingPath?, title? }` para `docs`/
`adr`, ou `{ kind: 'session', sessionId, eventId?, title? }` para `session`.
A discriminação existe para quem consome nunca precisar checar dois campos
opcionais para saber qual é `null` — o `tsc` torna a checagem exaustiva.

## Consequências

**"Cobertura do índice" (o painel que o handoff pede) responde com o que dá
para responder HONESTAMENTE hoje**: `GetRagCoverageUseCase` conta arquivos
`.md` reais no repositório contra quantos têm chunk, e sessões do projeto
contra quantas têm chunk. Não inclui "reindexado há 12min" — não existe
coluna de timestamp de indexação por escopo, e um número chutado mentiria.

**Reindexação é sempre MANUAL** (`POST .../rag/reindex`, `role:maintainer`,
full rebuild idempotente por `deleteByScope`/`deleteBySession` seguido de
recriação). Não há watcher por push nem por fechamento de sessão — decisão
já registrada no ADR 0079 ("reindexar é responsabilidade de quem escrever o
pipeline"), e esta onda escreveu o pipeline SOB DEMANDA, não reativo.
Código-fonte e Pull Requests continuam fora do índice, pela mesma razão do
ADR 0079.

**Metering de embedding continua fora** (mesmo corte do ADR 0075): o
provider fixo é local e gratuito (`ollama`), então não há custo a
registrar hoje; o dia em que um provider pago de embedding entrar, essa
lacuna precisa fechar antes.

**HTTP já nesta onda, antes da tela (Onda 5).** `POST .../rag/search`,
`POST .../rag/reindex` e `GET .../rag/coverage` existem porque a tela do
Chat RAG depende do contrato de busca e citação para ser construída sem
adivinhar forma — o handoff já assume "busca híbrida · embeddings + BM25 ·
limiar X" e um painel de cobertura, e os dois só têm dado real depois destas
três rotas.
