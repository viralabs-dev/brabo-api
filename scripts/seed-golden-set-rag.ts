/**
 * Seed + execução do golden-set de ACURÁCIA da busca híbrida do RAG
 * (docs/adr/0132-golden-set-de-acerto-do-rag.md), molde de
 * `seed-golden-set-qa.ts` (ADR 0123) aplicado a um domínio diferente.
 *
 * ## Por que este script faz o QUE o teste ExUnit faria na versão QA
 *
 * No golden-set do QA, quem julga é um LLM rodando DENTRO do engine
 * (`Engine.Gates.QaAutomacaoAgent.run/5`) — por isso o seed só PROVISIONA, e
 * `qa_automacao_agent_golden_test.exs` é quem RODA o julgamento. Aqui não há
 * julgamento nenhum do lado do engine: a busca híbrida inteira — embedding,
 * `ts_rank`, fusão por peso, corte por limiar — roda dentro do processo da
 * api (`HybridSearchUseCase`), a mesma classe que a rota HTTP
 * `POST projects/:id/rag/search` chama. Não haveria nada para o Elixir
 * "rodar" além de reimplementar a busca em Elixir só para este teste — e
 * isso testaria uma SEGUNDA implementação, nunca a real. Por isso o
 * script faz as DUAS coisas — provisiona E busca — e devolve o resultado já
 * pronto; `rag_golden_test.exs` só invoca este script (via `System.cmd`,
 * mesmo mecanismo do lado QA) e aplica o piso ratchet sobre o JSON que volta.
 *
 * ## De onde vêm as perguntas
 *
 * As 17 perguntas do golden-set (const `CASOS` abaixo) são COMPOSTAS a partir
 * de RNs e ADRs REAIS deste repositório — não são extração literal de
 * pergunta que alguém formulou usando o produto. Verificado antes de escrever
 * este comentário: `gh issue list` neste repositório devolve "No Issues" (é
 * projeto solo, sem rastro de pergunta real de usuário em issue/PR), então a
 * composição é a via que o ADR 0132 documenta como aceita quando não há
 * corpus genuíno — a alternativa (inventar sem lastro em RN/ADR nenhum)
 * mediria uma pergunta que ninguém faria.
 *
 * ## De onde vem o CORPUS indexado
 *
 * Um subconjunto REAL de `docs/` deste próprio monorepo — não conteúdo
 * sintético como o esqueleto Node.js do golden-set do QA. Os arquivos em
 * `ARQUIVOS_CURADOS` são copiados VERBATIM (mesmo conteúdo, mesmo caminho
 * relativo) para o repositório do projeto semeado, e é o mesmo
 * `IndexProjectDocsUseCase` que qualquer projeto real usa que os indexa —
 * zero atalho de indexação só para o teste. O subconjunto é curado (~22
 * arquivos, não os +130 ADRs reais) por custo de embedding: um golden-set que
 * indexasse a árvore `docs/` inteira multiplicaria o tempo de uma rodada
 * manual sem melhorar o que ele mede (a busca entre poucas centenas de chunks
 * já testa fusão vetor+léxico igual a busca entre milhares).
 *
 * ## Por que UM projeto, e não um por caso (diferente do QA)
 *
 * O golden-set do QA precisa de um repositório isolado por caso porque cada
 * caso testa uma REGRA DE NEGÓCIO diferente sobre um código diferente. Aqui
 * os 17 casos são perguntas sobre o MESMO corpus de documentação — dividir em
 * 17 projetos exigiria indexar o mesmo conteúdo 17 vezes (17x o custo de
 * embedding) só para isolar buscas que já são, por natureza, somente-leitura
 * e sem efeito colateral entre si.
 *
 * ## Telemetria: LIGADA de propósito (RN-479)
 *
 * `HybridSearchUseCase` grava uma linha em `rag_searches` a cada chamada,
 * sempre — não há como (nem deveria haver) desligar isso por fora. A decisão
 * aqui não é "desligar", é "isso é um problema?": NÃO. `medir:rag` exige
 * `--projeto <uuid>` (nunca agrega globalmente), e este script sempre cria um
 * projeto NOVO, isolado, com sufixo de timestamp — as linhas que ele grava
 * não aparecem em `medir:rag` de nenhum projeto real, pelo mesmo motivo que o
 * golden-set do QA não polui métrica nenhuma de projeto real. E gravar de
 * verdade é o que faz este golden-set exercitar o MESMO caminho de código que
 * a Chat RAG real usa — desligar a telemetria testaria uma busca ligeiramente
 * diferente da que o produto roda.
 *
 * Uso: pnpm --filter api golden-set:rag-seed
 * (chamado por `apps/engine/test/engine/rag/rag_golden_test.exs`, via
 * `System.cmd` — mas roda solto também, pra depuração.)
 *
 * PRÉ-REQUISITOS: api alcançando Postgres (mesmo `DATABASE_URL` que o
 * processo real usa) e Ollama respondendo com `nomic-embed-text` já puxado
 * (`RAG_EMBEDDING_MODEL`, `rag-search-limits.ts`) — sem isso a indexação
 * degrada para léxico-only e o script recusa medir (ver `main()`).
 *
 * NÃO faz limpeza — mesma postura de `seed-golden-set-qa.ts` (sufixo por
 * timestamp, nunca apagado).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { users, workspaces, projects, projectMembers } from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { IndexProjectDocsUseCase } from '../src/application/use-cases/rag/index-project-docs.use-case';
import { HybridSearchUseCase } from '../src/application/use-cases/rag/hybrid-search.use-case';
import { ProvisionedRepositoryRepository } from '../src/application/ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../src/application/ports/git-provider.port';
import type { Actor } from '../src/domain/sessions/session-event.entity';
import { workspaceDirNameFor } from '../src/infrastructure/filesystem/project-workspaces-root';
import { RAG_EMBEDDING_MODEL } from '../src/domain/rag/rag-search-limits';
import {
  acertouCaminhoEsperado,
  rankDoCaminhoEsperado,
  GOLDEN_SET_RAG_TOP_K,
} from '../src/domain/rag/golden-set-criterio';

// raiz do monorepo — apps/api/scripts/ -> apps/api -> apps -> raiz.
const REPO_ROOT = resolve(__dirname, '../../..');

function log(msg: string) {
  console.error(msg); // stderr: o stdout é só o JSON de saída (ver main()).
}

// --- o corpus curado -----------------------------------------------------

/**
 * Subconjunto REAL de `docs/` deste monorepo. Cada caminho é relativo à raiz
 * do repositório E é o mesmo caminho que o chunk vai carregar depois de
 * indexado — `CASOS.expectedPath` abaixo tem que bater exatamente com um
 * destes.
 *
 * Os dois últimos (`docs/architecture.md`, `docs/glossary.md`) são
 * DISTRATORES deliberados: nenhum caso do golden-set espera acertar neles —
 * eles só engordam o corpus, para a busca ter algo além do que qualquer caso
 * pergunta (um corpus onde cada arquivo é a resposta de exatamente uma
 * pergunta testaria pouco além de "o índice não está vazio").
 */
const ARQUIVOS_CURADOS = [
  'docs/business-rules.md',
  'docs/business-rules/custo.md',
  'docs/business-rules/autenticacao.md',
  'docs/adr/0020-destravar-gates-qa-secops.md',
  'docs/adr/0054-gates-como-registro-declarativo.md',
  'docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md',
  'docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md',
  'docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md',
  'docs/adr/0084-login-social-github-e-gitlab.md',
  'docs/adr/0095-gate-necessidade-validada.md',
  'docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md',
  'docs/adr/0121-schema-dividido-por-agregado-de-dominio.md',
  'docs/adr/0123-golden-set-regressao-qa-automacao.md',
  'docs/adr/0127-tetos-de-rebaixamento-em-project-members.md',
  'docs/adr/0129-telemetria-de-busca-do-rag-como-tabela.md',
  'docs/adr/0130-broker-de-container.md',
  'docs/explanation/gates.md',
  'docs/explanation/branching-policy.md',
  'docs/explanation/backlog.md',
  'docs/explanation/achados-execucao-real.md',
  'docs/architecture.md',
  'docs/glossary.md',
] as const;

// --- os 17 casos -----------------------------------------------------------

interface CasoRag {
  id: string;
  query: string;
  /** Caminho de ARQUIVO — nunca chunk exato (ver o comentário do topo). */
  expectedPath: string;
}

const CASOS: CasoRag[] = [
  {
    id: 'escopo-caminho-terminal',
    query:
      "Why does the terminal's path-scope cap in decide() refuse a `cwd` outside the project root, even when the command matches an allow pattern?",
    expectedPath: 'docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md',
  },
  {
    id: 'verbo-allowlist-nao-converge',
    query:
      "Why doesn't the terminal's verb allowlist converge against an agent that keeps finding new ways to run the same command?",
    expectedPath: 'docs/explanation/achados-execucao-real.md',
  },
  {
    id: 'gates-registro-nao-executa',
    query:
      'Why is `docs/gates.yml` described as an index rather than the policy itself?',
    expectedPath: 'docs/explanation/gates.md',
  },
  {
    id: 'necessidade-validada-warn',
    query:
      'Why was the `necessidade-validada` gate born `warn` instead of `block`?',
    expectedPath: 'docs/adr/0095-gate-necessidade-validada.md',
  },
  {
    id: 'golden-set-qa-exunit',
    query:
      "Why is the QA Automation agent's golden-set an ExUnit test instead of a Mix.Task?",
    expectedPath: 'docs/adr/0123-golden-set-regressao-qa-automacao.md',
  },
  {
    id: 'schema-por-agregado-barrel',
    query:
      'Why was the Postgres schema split into one file per domain aggregate, behind a barrel file?',
    expectedPath: 'docs/adr/0121-schema-dividido-por-agregado-de-dominio.md',
  },
  {
    id: 'chunks-vetor-tsvector-mesma-tabela',
    query:
      'Why do the RAG chunks keep the vector and the tsvector on the same table row instead of two separate tables?',
    expectedPath: 'docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md',
  },
  {
    id: 'pesos-busca-hibrida',
    query:
      'Why does the hybrid search weigh the vector signal higher than the lexical one?',
    expectedPath: 'docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md',
  },
  {
    id: 'login-social-email-nao-verificado',
    query:
      "What happens when a social login provider's email matches an existing account whose email isn't verified yet?",
    expectedPath: 'docs/adr/0084-login-social-github-e-gitlab.md',
  },
  {
    id: 'workspace-verificado-runner',
    query:
      "What actually confirms that a `runner`-mode project's folder is valid?",
    expectedPath:
      'docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md',
  },
  {
    id: 'isolation-nenhum-servico-chama-docker',
    query:
      'Why is the Isolation backlog item still open, with no service in the product calling Docker?',
    expectedPath: 'docs/explanation/backlog.md',
  },
  {
    id: 'merge-protegida-nunca-automatico',
    query:
      'Why can merging into a protected branch never be auto-approved, even with agent autonomy turned on?',
    expectedPath: 'docs/business-rules.md',
  },
  {
    id: 'instruction-patch-nunca-auto-aprovavel',
    query: 'Why is an instruction patch never auto-approvable?',
    expectedPath: 'docs/business-rules.md',
  },
  {
    id: 'branch-taxonomia-de-dev',
    query: 'What branch-type taxonomy is used for work that starts from `dev`?',
    expectedPath: 'docs/explanation/branching-policy.md',
  },
  {
    id: 'tetos-de-rebaixamento-project-members',
    query:
      'Quais são os dois tetos que impedem rebaixar um membro de projeto, mesmo com a sobreposição de papel valendo nos dois sentidos?',
    expectedPath: 'docs/adr/0127-tetos-de-rebaixamento-em-project-members.md',
  },
  {
    id: 'telemetria-rag-pesos-congelados',
    query:
      'Por que a telemetria de busca do RAG grava os pesos CONGELADOS na própria linha, em vez de ler os valores vigentes depois?',
    expectedPath: 'docs/adr/0129-telemetria-de-busca-do-rag-como-tabela.md',
  },
  {
    id: 'broker-nao-aceita-spec-docker',
    query:
      'Por que o broker de container não aceita a especificação de Docker de quem chama, e computa tudo sozinho?',
    expectedPath: 'docs/adr/0130-broker-de-container.md',
  },
];

// --- main ------------------------------------------------------------------

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const repos = app.get(ProvisionedRepositoryRepository);
  const registry = app.get(GitProviderRegistry);
  const indexDocs = app.get(IndexProjectDocsUseCase);
  const search = app.get(HybridSearchUseCase);

  const sufixo = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `golden-rag-${sufixo}`,
      email: `golden-rag-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'golden-rag',
      slug: `golden-rag-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  log(`✓ workspace: ${workspace.id}`);

  // `execution_mode: 'runner'` (com `workspace_path` não-nulo, exigido pelo
  // CHECK `projects_workspace_path_casa_com_modo`) — de propósito, não
  // `container` (o default). `ReadProjectCodeUseCase.portaoDoContainer`
  // (RN-105) recusa com 409 QUALQUER leitura de projeto `container` sem o
  // Arquiteto ter decidido uma imagem, e este script nunca aciona o
  // Arquiteto — não há execução nenhuma para justificar isso aqui, só
  // indexação de documentação. RN-169/421 isentam `mounted`/`runner` do
  // portão inteiro, exatamente para este tipo de caso: projeto sem container
  // próprio não tem por que esperar decisão de imagem para ter o código
  // (aqui, os docs) lido.
  const projectId = randomUUID();
  const slug = `golden-rag-${sufixo}`;
  const [project] = await db
    .insert(projects)
    .values({
      id: projectId,
      workspaceId: workspace.id,
      name: 'golden-rag',
      slug,
      createdBy: user.id,
      workspaceDirName: workspaceDirNameFor(projectId, slug),
      executionMode: 'runner',
      workspacePath: `/home/golden-rag/${slug}`,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: slug,
    visibility: 'private',
  });
  const repo = await repos.findByProjectId(project.id);
  if (!repo) throw new Error(`repo não provisionado para ${project.id}`);

  log(
    `✓ projeto: ${project.id} (execution_mode=runner, ${ARQUIVOS_CURADOS.length} arquivos curados)`,
  );

  // Lê o corpus curado do PRÓPRIO monorepo e commita VERBATIM, no mesmo
  // caminho relativo — é o que faz `expectedPath` em CASOS bater com
  // `chunk.sourcePath` depois da indexação.
  const arquivos = await Promise.all(
    ARQUIVOS_CURADOS.map(async (caminho) => ({
      path: caminho,
      content: await readFile(join(REPO_ROOT, caminho), 'utf-8'),
    })),
  );
  await registry.get('local').commitFiles({
    externalId: repo.externalId,
    branch: repo.defaultBranch,
    message: `chore: corpus curado do golden-set de RAG (${ARQUIVOS_CURADOS.length} arquivos)`,
    files: arquivos,
    accessToken: '',
  });
  log(
    `✓ corpus commitado (${arquivos.length} arquivos, ${arquivos.reduce((n, a) => n + a.content.length, 0)} chars)`,
  );

  const relatorioIndexacao = await indexDocs.execute(project.id);
  log(
    `✓ indexado: ${relatorioIndexacao.docsChunks + relatorioIndexacao.adrChunks} chunks ` +
      `(docs=${relatorioIndexacao.docsChunks}, adr=${relatorioIndexacao.adrChunks}), ` +
      `embedding.available=${relatorioIndexacao.embedding.available}` +
      (relatorioIndexacao.embedding.reason
        ? ` (${relatorioIndexacao.embedding.reason})`
        : ''),
  );

  // Sem vetor, a busca rodaria só léxico-only — o que ela mediria não seria
  // a busca híbrida, é a metade dela (mesmo critério de reprovação de
  // `medir-rag.ts`). O JSON ainda sai, com `vectorAvailable: false` — quem
  // decide se isso vira SKIP (não falha) é `rag_golden_test.exs`, do lado
  // Elixir, no mesmo espírito do `setup_all` que pula quando a api está
  // inalcançável.
  interface ResultadoCaso {
    id: string;
    query: string;
    expectedPath: string;
    passou: boolean;
    rank: number | null;
    vectorAvailable: boolean;
    hits: { sourcePath: string | null; score: number }[];
  }

  const ator: Actor = { kind: 'user', id: user.id };
  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS) {
    const resultado = await search.execute({
      projectId: project.id,
      query: caso.query,
      scopes: ['docs', 'adr'],
      limit: GOLDEN_SET_RAG_TOP_K,
      actor: ator,
      sessionId: null,
    });
    const passou = acertouCaminhoEsperado(resultado.hits, caso.expectedPath);
    const rank = rankDoCaminhoEsperado(resultado.hits, caso.expectedPath);
    resultados.push({
      id: caso.id,
      query: caso.query,
      expectedPath: caso.expectedPath,
      passou,
      rank,
      vectorAvailable: resultado.vectorAvailable,
      hits: resultado.hits.map((h) => ({
        sourcePath: h.origin.kind === 'file' ? h.origin.sourcePath : null,
        score: h.score,
      })),
    });
    log(
      `${passou ? '✓' : '✗'} ${caso.id}: esperado=${caso.expectedPath} ` +
        `rank=${rank ?? '—'} vectorAvailable=${resultado.vectorAvailable}`,
    );
  }

  await app.close();

  // ÚNICA coisa no stdout — o teste Elixir faz `Jason.decode!` direto nele.
  process.stdout.write(
    JSON.stringify({
      embeddingModel: RAG_EMBEDDING_MODEL,
      topK: GOLDEN_SET_RAG_TOP_K,
      projectId: project.id,
      indexReport: relatorioIndexacao,
      cases: resultados,
    }),
  );
}

main().catch((error) => {
  console.error('\nSeed do golden-set de RAG falhou:', error);
  process.exit(1);
});
