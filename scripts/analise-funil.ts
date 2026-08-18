/**
 * O relatório de funil de entrega e DORA parcial (docs/fluxo.yml, papéis
 * `analytics` e `delivery-metricas`, ADR 0089).
 *
 * Uso: pnpm --filter api analise:funil -- --projeto <uuid> [--json]
 *
 * ## Por que ele existe
 *
 * `docs/fluxo.yml` descrevia os dois papéis como `proposto`, com o critério
 * de separação já escrito: `analytics` é "absorvido por `medicao`" até
 * métrica de PRODUTO virar entrada obrigatória do PO, e `delivery-metricas`
 * "nunca vira agente — vira RELATÓRIO do medicao". O dono do produto decidiu
 * antecipar essa construção sem esperar o gatilho orgânico. O que os dois
 * papéis pedem hoje é o mesmo instrumento: um SCRIPT, no formato de
 * `medir-execucao.ts` — leitura pura via Drizzle, sem escrita nenhuma, sem
 * GenServer, sem agente de LLM.
 *
 * ## O que ele mede DE VERDADE
 *
 * O funil sessão → commit → PR → merge sai de `proposed_actions` filtrado
 * pelos três `actionType` que o dev agent produz com efeito git real
 * (`git_commit`, `pr_open`, `git_merge` — ver
 * `apps/api/src/domain/git/git-action-execution-result.ts`), só contando
 * ação `executed` (a que tem `execution_result` de verdade gravado por
 * `ExecuteGitActionUseCase`). Lead time usa `updated_at` da linha — é o
 * instante em que `updateExecutionResult` gravou o resultado, não quando a
 * ação foi PROPOSTA. Deployment frequency filtra `git_merge` cujo
 * `targetBranch` está em `PROTECTED_BRANCHES`.
 *
 * ## O que ele DECLARA ausente, de propósito
 *
 * Três métricas não têm CAMINHO nenhum para existir hoje, e o script diz
 * isso em vez de aproximar com um número que pareceria real:
 *
 * 1. **Funil de produto completo (ideação → commit).** `sessions` não tem
 *    `storyId` — RN-230 já declara essa lacuna na aba Criativo. Fechá-la
 *    exigiria schema novo, fora de escopo desta frente (nenhuma migration).
 * 2. **Evidência de adoção por feature.** O Brabo não instrumenta os
 *    projetos que ele CONSTRÓI — não há pipeline de telemetria de uso saindo
 *    do código gerado. Isso não é dado que falta coletar: é capacidade que o
 *    produto não tem caminho nenhum para ter hoje.
 * 3. **MTTR e change failure rate.** As duas exigem sinal de INCIDENTE de
 *    produção real — a mesma dependência que `docs/fluxo.yml` já registra
 *    para `secops-runtime`/`platform` (`status: proposto`/`planned`,
 *    ativação sincronizada com `DEPLOY_ENABLED`). Outra frente, não esta.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { projects } from '../src/db/schema';
import { formatarDuracao } from './medir-execucao';
// As funções de CÁLCULO puras e a query que monta `AcaoGit[]` migraram para
// `src/application/services/funil-metrics.ts` (RN-407): a leitura do PO
// (`ListProductMetricsUseCase`) precisava do mesmo cálculo, e um caso de uso
// em `src/` não pode importar de `scripts/` — a direção é sempre
// `scripts/` → `src/`. Este arquivo REEXPORTA em vez de definir localmente;
// nenhuma assinatura mudou, e `test/scripts/analise-funil.spec.ts` continua
// verde sem ser tocado.
import {
  buscarAcoesGitDoFunil,
  calcularFunil,
  calcularLeadTimes,
  leadTimeMedioMs,
  deploymentFrequencyPorDia,
  type FunilResultado,
  type FrequenciaPorDia,
} from '../src/application/services/funil-metrics';

export {
  ACOES_DO_FUNIL,
  calcularFunil,
  calcularLeadTimes,
  leadTimeMedioMs,
  deploymentFrequencyPorDia,
} from '../src/application/services/funil-metrics';
export type {
  AcaoDoFunil,
  AcaoGit,
  EtapaFunil,
  FunilResultado,
  LeadTime,
  FrequenciaPorDia,
} from '../src/application/services/funil-metrics';

interface Opcoes {
  projeto: string;
  json: boolean;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const projeto = args[args.indexOf('--projeto') + 1];

  if (!args.includes('--projeto') || !projeto || projeto.startsWith('--')) {
    console.error('uso: analise-funil.ts --projeto <uuid> [--json]');
    process.exit(2);
  }

  return { projeto, json: args.includes('--json') };
}

interface Relatorio {
  projeto: { id: string; nome: string };
  totalAcoesConsideradas: number;
  funil: FunilResultado;
  leadTimes: {
    porSessao: {
      sessionId: string;
      primeiroCommitEm: string;
      primeiroMergeEm: string;
      leadTime: string;
    }[];
    medio: string | null;
  };
  deploymentFrequency: FrequenciaPorDia[];
}

async function main() {
  const { projeto, json } = lerOpcoes();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  const [projetoRow] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projeto));

  if (!projetoRow) {
    console.error(`projeto ${projeto} não existe`);
    await app.close();
    process.exit(2);
  }

  const acoes = await buscarAcoesGitDoFunil(db, projeto);

  const funil = calcularFunil(acoes);
  const leadTimes = calcularLeadTimes(acoes);
  const media = leadTimeMedioMs(leadTimes);
  const frequencia = deploymentFrequencyPorDia(acoes);

  const relatorio: Relatorio = {
    projeto: { id: projetoRow.id, nome: projetoRow.name },
    totalAcoesConsideradas: acoes.length,
    funil,
    leadTimes: {
      porSessao: leadTimes.map((l) => ({
        sessionId: l.sessionId,
        primeiroCommitEm: l.primeiroCommitEm.toISOString(),
        primeiroMergeEm: l.primeiroMergeEm.toISOString(),
        leadTime: formatarDuracao(l.leadTimeMs),
      })),
      medio: media === null ? null : formatarDuracao(media),
    },
    deploymentFrequency: frequencia,
  };

  if (json) {
    console.log(JSON.stringify(relatorio, null, 2));
  } else {
    imprimir(relatorio);
  }

  await app.close();
}

function formatarTaxa(taxa: number | null): string {
  return taxa === null ? '—' : `${(taxa * 100).toFixed(0)}%`;
}

/** Markdown, mesmo espírito de `medir-execucao.ts` — cai no doc sem redigitação. */
function imprimir(r: Relatorio) {
  console.log(`# Funil de entrega — ${r.projeto.nome}\n`);
  console.log(`- projeto: \`${r.projeto.id}\``);
  console.log(
    `- ações git consideradas (git_commit/pr_open/git_merge, qualquer status): ${r.totalAcoesConsideradas}\n`,
  );

  console.log('## Funil real (sessão → commit → PR → merge)\n');
  console.log('| etapa | sessões | conversão da etapa anterior |');
  console.log('|---|---|---|');
  for (const e of r.funil.etapas) {
    console.log(
      `| ${e.etapa} | ${e.sessoes} | ${formatarTaxa(e.taxaDaEtapaAnterior)} |`,
    );
  }

  console.log('\n## Lead time real (primeiro commit → primeiro merge)\n');
  console.log(
    `- média: ${r.leadTimes.medio ?? '— (nenhuma sessão com commit E merge)'}`,
  );
  if (r.leadTimes.porSessao.length > 0) {
    console.log('\n| sessão | primeiro commit | primeiro merge | lead time |');
    console.log('|---|---|---|---|');
    for (const l of r.leadTimes.porSessao) {
      console.log(
        `| \`${l.sessionId}\` | ${l.primeiroCommitEm} | ${l.primeiroMergeEm} | ${l.leadTime} |`,
      );
    }
  }

  console.log(
    '\n## Deployment frequency real (merge em branch protegida, por dia)\n',
  );
  console.log(
    '_cruza por referência com o gate `backmerge` (docs/gates.yml) — a evidência dele é CI, fora do alcance deste script._\n',
  );
  if (r.deploymentFrequency.length === 0) {
    console.log('_nenhum merge em branch protegida._');
  } else {
    console.log('| dia | merges |');
    console.log('|---|---|');
    for (const f of r.deploymentFrequency) {
      console.log(`| ${f.dia} | ${f.merges} |`);
    }
  }

  console.log('\n## Não medido, de propósito\n');
  console.log(
    '- **Funil de produto completo (ideação → commit)**: `sessions` não tem ' +
      '`storyId` — RN-230 já declara a lacuna na aba Criativo. Fechá-la exige ' +
      'schema novo, fora do escopo desta frente.',
  );
  console.log(
    '- **Evidência de adoção por feature**: o Brabo não instrumenta os ' +
      'projetos que ele CONSTRÓI. Não é dado que falta coletar — é ' +
      'capacidade que o produto não tem caminho nenhum para ter hoje.',
  );
  console.log(
    '- **MTTR e change failure rate**: exigem sinal de incidente de ' +
      'produção real, a mesma dependência declarada em `docs/fluxo.yml` para ' +
      '`secops-runtime`/`platform` (ativação junto de `DEPLOY_ENABLED`).',
  );
}

// Só roda como CLI. Sem esta guarda, importar o módulo no teste dispararia a
// leitura inteira — subindo o Nest e derrubando o processo no `process.exit`
// do parser de argumentos.
if (process.argv[1]?.endsWith('analise-funil.ts')) void main();
