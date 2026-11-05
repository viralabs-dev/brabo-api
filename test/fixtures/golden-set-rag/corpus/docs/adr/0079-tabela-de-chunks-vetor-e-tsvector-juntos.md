# ADR 0079 — Tabela de chunks: vetor e `tsvector` na mesma linha

- **Status:** aceito
- **Data:** 2026-08-15
- **Contexto anterior:** [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)
  (embeddings no contrato de `LLMProvider`, fundação sem consumo — `embed?`
  provado só contra o Ollama), [ADR 0072](0072-projeto-local-ou-container.md)
  (CHECK no banco para amarrar um par de colunas mutuamente exclusivo, mesmo
  padrão usado aqui para `session_id`/`source_path`), [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  (por que a aba continua rotulada "Chat", não "Chat RAG" — esta migração NÃO
  muda esse rótulo)

## Contexto

O Chat RAG que o handoff de design anuncia (`design_handoff_brabo/designs/Brabo
Chat.dc.html`) precisa de um lugar para guardar trechos indexados com vetor de
embedding — hoje não existe NENHUMA tabela para isso. O ADR 0075 deixou o
contrato pronto (`LLMProvider.embed?`, capability provada no Ollama com
`nomic-embed-text`, vetores de 768 dimensões), mas nada ainda escreve ou lê um
índice: sem tabela, o contrato é uma porta sem sala do outro lado.

Duas perguntas precisavam de decisão antes de gerar a migração, e as duas são
estruturais, não de implementação:

1. **Vetor e busca léxica moram na mesma tabela, ou em duas?** A Onda 4 (fora
   do escopo desta migração) vai construir busca HÍBRIDA — semântica
   (`pgvector`, similaridade de cosseno) e léxica (`tsvector`, full-text do
   Postgres) combinadas. Se as duas informações vivessem em tabelas
   separadas, toda busca híbrida precisaria de um JOIN por `chunk_id`, e as
   duas tabelas poderiam divergir (um trecho com vetor mas sem entrada léxica,
   ou vice-versa) sem nenhum mecanismo do banco impedindo.
2. **Quais escopos o índice cobre?** O handoff insinua "buscar no projeto", o
   que é vago demais para desenhar uma coluna. A investigação achou EXATAMENTE
   três fontes de texto que o produto já produz e sabe de onde vieram: os
   arquivos de `docs/`, os ADRs (que também são arquivos, mas com identidade
   própria — um ADR é citável por número, um doc genérico não) e as sessões
   (o event log já tem texto de sobra). Código-fonte e Pull Requests ficaram
   de fora DE PROPÓSITO: os dois mudam a cada `push`, e indexá-los sem um
   watcher de reindexação faria o índice **mentir** sobre cobertura — a
   mesma classe de erro que o ADR 0042 já recusa para capability de modelo
   ("declarar sem provar"). Três escopos com cobertura HONESTA valem mais que
   cinco com um número inventado.

Um terceiro ponto não era decisão de produto, mas achado técnico com
consequência de deploy: `docker/postgres/init.sql:2` roda `CREATE EXTENSION
IF NOT EXISTS vector`, mas esse arquivo só executa na PRIMEIRA inicialização
do volume Postgres. Um ambiente com volume antigo — inclusive, possivelmente,
produção — pode não ter a extensão instalada, e criá-la exige privilégio que o
role da aplicação pode não ter.

## Decisão

**Uma tabela só, `chunks`, com `embedding vector(768)` e `search_vector
tsvector` como colunas irmãs da mesma linha.** `search_vector` é `GENERATED
ALWAYS AS (to_tsvector('portuguese', content)) STORED` — nunca escrita pela
aplicação, sempre coerente com `content` por construção do Postgres, e pronta
na mesma transação do `INSERT` (não depende de nenhum provider de LLM
responder). `embedding` é NULLABLE: o pipeline de indexação (Onda 4) ainda não
existe, e fazer o CHUNK (o recorte de texto) esperar o VETOR misturaria duas
falhas de natureza diferente — parsing de documento contra chamada de rede a
um provider — numa só escrita atômica.

**Índice HNSW sobre `embedding` (`vector_cosine_ops`), não IVFFlat.** IVFFlat
precisa de linhas já carregadas para treinar as listas (`lists`) — construído
sobre uma tabela vazia, que é exatamente o estado desta tabela ao nascer (sem
pipeline de indexação ainda), o índice fica ruim até alguém o reconstruir
manualmente depois de popular. HNSW constrói o grafo incrementalmente,
inserção por inserção, sem etapa de treino — o índice fica bom desde a
primeira linha. `vector_cosine_ops` porque é a métrica que embeddings de texto
geralmente esperam (o ranking de similaridade não deveria mudar com a
magnitude do vetor).

**Índice GIN sobre `search_vector`** — a metade léxica pronta para a busca
híbrida da Onda 4 usar via `@@`/`ts_rank`, sem precisar calcular nada em tempo
de consulta.

**Os três escopos (RN-219) são um `pgEnum` — `docs` | `adr` | `session` — e
`session_id`/`source_path` são mutuamente exclusivos por CHECK, não por
convenção de aplicação**, o mesmo padrão que o ADR 0072 usou para
`workspace_mode`/`workspace_path`: `scope = 'session'` exige `session_id`
preenchido e recusa `source_path`; `docs`/`adr` exigem `source_path` (caminho
relativo do arquivo fonte) e recusam `session_id`. A trava fica no banco
porque quem vai escrever esta tabela é um pipeline (Onda 4) que não
necessariamente passa pelo mesmo caso de uso toda vez — um script de
reindexação em lote é um candidato óbvio a burlar validação só de aplicação.

**A migração carrega `CREATE EXTENSION IF NOT EXISTS vector` ela mesma**, em
vez de assumir que `docker/postgres/init.sql` já rodou. `IF NOT EXISTS` é
idempotente — local (onde a extensão já está instalada, confirmado por
`SELECT * FROM pg_extension WHERE extname='vector'` antes de escrever este
ADR) e um ambiente novo passam pela mesma linha sem diferença de
comportamento visível.

**Esta migração nasce em branch `breaking/`, não `feature/`.** Criar uma
extensão exige que o role da aplicação tenha `CREATEDB` (ou que a extensão
esteja marcada "trusted" pelo DBA). Localmente o role é superusuário
(confirmado por `SELECT rolsuper FROM pg_roles WHERE rolname=current_user`),
mas nada garante isso em produção — gerenciadores de Postgres administrado
frequentemente não dão superusuário à aplicação. Se a migração falhar aí, é
ação do OPERADOR antes do deploy (rodar `CREATE EXTENSION vector;` uma vez,
como superusuário), não bug do produto — exatamente o critério que o
CLAUDE.md já usa para decidir `breaking/` versus `bugfix/`/`feature/`: "mudança
que exige ação do operador antes do deploy nasce em `breaking/` mesmo quando o
conteúdo é correção".

## Consequências

**O que esta migração entrega é só a FUNDAÇÃO**: a tabela, os índices, o
repositório de escrita/leitura básica (`ChunkRepository`). Ela não escreve
nenhuma linha — não há pipeline de indexação, não há busca híbrida, não há UI.
A aba continua "Chat" (ADR 0078); nada muda no rótulo até a Onda 4 entregar o
que o nome "Chat RAG" promete.

**Reindexar `docs`/`adr` é responsabilidade de quem escrever o pipeline
(Onda 4), não desta migração** — a tabela não tem coluna de hash/versão do
arquivo fonte para detectar mudança, porque essa decisão pertence a quem vai
efetivamente rodar a reindexação e sabe qual estratégia (hash de conteúdo,
`mtime`, versão do commit) faz sentido para o watcher que ainda não existe.

**Código-fonte e PRs continuam fora do índice.** Se um dia entrarem, a decisão
tem de vir com um mecanismo de reindexação por push — não é extensão trivial
do enum `chunk_scope`, porque a garantia de cobertura honesta desta tabela
depende de cada escopo ter uma história clara de "quando este chunk fica
desatualizado".

**Em produção, esta migração pode parar no `CREATE EXTENSION`** se o role da
aplicação não tiver privilégio — comportamento intencional (falhar alto e
cedo) em vez de a tabela nascer sem o tipo `vector` disponível e falhar de
um jeito mais confuso lá na frente, na primeira tentativa de `INSERT`.
