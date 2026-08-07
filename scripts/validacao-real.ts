/**
 * A validação REAL da FASE 13b — GitHub remoto, dev agent real, gates por LLM.
 *
 * Uso: pnpm --filter api validacao:real -- --repo <owner/repo> [--ate <fase>]
 *
 * ## O que ela prova que a da Fase 12 NÃO provava
 *
 * A `validacao-fase-12.ts` declara os próprios limites com todas as letras:
 * roda no `LocalGitProvider`, com o `NoopDevAgent`, e com o veredito de gate
 * escrito pelo próprio script. Ela existe para provar a CADEIA (adoção →
 * promoção → reagendamento → gate → trava de merge) sem depender de rede nem
 * de julgamento de modelo.
 *
 * Esta aqui troca exatamente as três coisas que aquela deixou de fora:
 *
 *   * **GitHub remoto** em vez de bare local — `getRepo` de verdade, PR de
 *     verdade, rede de verdade;
 *   * **dev agent real** em vez do Noop — LLM escrevendo código;
 *   * **gates por LLM** em vez de veredito escrito pelo script.
 *
 * O que ela NÃO faz continua sendo o mesmo, e por desenho: **merge**. Merge em
 * branch protegida é decisão do usuário ([RN-014]), e nenhuma automação do
 * produto o executa.
 *
 * ## O owner é REAL, não um usuário descartável
 *
 * A `validacao-fase-12` cria usuário e workspace próprios porque não gasta
 * token nem toca em rede. Aqui não dá: pela **RN-058**, a chave que o agente
 * gasta é a do OWNER do workspace, lida do banco. Um usuário novo não tem
 * credencial nenhuma, e a execução morreria no primeiro turno.
 *
 * Por isso o pré-voo escolhe o usuário que tem AS DUAS credenciais — git e
 * LLM — e falha cedo, antes de criar qualquer coisa, se não houver nenhum.
 * Escolher pela credencial de git sozinha pegava um usuário de demo sem chave
 * de modelo, e o erro só apareceria no primeiro turno pago.
 *
 * ## Fases
 *
 * `--ate` para em qualquer uma delas. Existe porque as fases têm custos
 * MUITO diferentes: `adocao` é grátis, `execucao` gasta dinheiro de verdade.
 * Rodar a barata primeiro, sozinha, é o que evita descobrir um erro de
 * configuração depois de já ter pago por ele.
 *
 *   adocao    — projeto + adoção remota + decisão do plano   (grátis)
 *   backlog   — story criada e promovida por você            (grátis)
 *   execucao  — dev agent real → PR remota → gates por LLM   (PAGO)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import {
  projectMembers,
  projectRepositories,
  projects,
  repoBootstraps,
  userCredentials,
  users,
  workspaces,
} from '../src/db/schema';
import { AdoptRepositoryUseCase } from '../src/application/use-cases/git/adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from '../src/application/use-cases/git/decide-bootstrap-plan.use-case';

type Fase = 'adocao' | 'backlog' | 'execucao';
const FASES: Fase[] = ['adocao', 'backlog', 'execucao'];

interface Opcoes {
  repo: string;
  ate: Fase;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const repo = args[args.indexOf('--repo') + 1];

  if (!args.includes('--repo') || !repo || repo.startsWith('--')) {
    console.error(
      'uso: validacao-real.ts --repo <owner/repo> [--ate adocao|backlog|execucao]',
    );
    process.exit(2);
  }

  const ateArg = args.includes('--ate')
    ? args[args.indexOf('--ate') + 1]
    : null;
  if (ateArg != null && !FASES.includes(ateArg as Fase)) {
    console.error(`--ate inválido: ${ateArg} (use ${FASES.join(' | ')})`);
    process.exit(2);
  }

  return { repo, ate: (ateArg as Fase) ?? 'execucao' };
}

function log(msg: string) {
  console.log(msg);
}

function assertar(condicao: boolean, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(`CRITÉRIO NÃO FECHOU: ${mensagem}`);
}

async function main() {
  const { repo, ate } = lerOpcoes();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  // ---------------- pré-voo: as credenciais existem? ----------------------
  //
  // ANTES de criar qualquer coisa. Descobrir que falta credencial depois de
  // montar projeto e sessão deixa lixo no banco e, na fase paga, depois de
  // já ter gasto.
  log('--- 0. pré-voo: credenciais do owner ---');

  const credenciais = await db.select().from(userCredentials);

  // Quem serve é quem tem AS DUAS: git para adotar e abrir PR, LLM para os
  // agentes gastarem (RN-058). Pegar a primeira credencial de git escolhia um
  // usuário de demo que nunca teve chave de modelo — e o erro só apareceria
  // no primeiro turno, depois de o projeto já existir.
  const providersPorUsuario = new Map<string, Set<string>>();
  for (const c of credenciais) {
    const atual = providersPorUsuario.get(c.userId) ?? new Set<string>();
    atual.add(c.provider);
    providersPorUsuario.set(c.userId, atual);
  }

  const candidatos = [...providersPorUsuario.entries()].filter(
    ([, providers]) =>
      providers.has('github') && [...providers].some((p) => p !== 'github'),
  );

  assertar(
    candidatos.length > 0,
    'nenhum usuário tem credencial de git E de LLM ao mesmo tempo — ' +
      'a adoção remota precisa da primeira, e os agentes da segunda (RN-058)',
  );

  const ownerId = candidatos[0][0];
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
  assertar(owner != null, `usuário ${ownerId} da credencial de git não existe`);

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.createdBy, owner.id));
  assertar(
    workspace != null,
    `o dono da credencial (${owner.email}) não criou workspace nenhum`,
  );

  const deLlm = credenciais.filter(
    (c) => c.userId === owner.id && c.provider !== 'github',
  );
  assertar(
    deLlm.length > 0,
    `o owner ${owner.email} não tem credencial de LLM — pela RN-058 é a chave DELE que os agentes gastam`,
  );

  log(`✓ owner: ${owner.email} · workspace: ${workspace.name}`);
  log(`✓ credenciais: github + ${deLlm.map((c) => c.provider).join(', ')}`);

  // ---------------- 1. projeto e adoção remota ----------------------------
  log('\n--- 1. adotar um repositório REMOTO que já existe ---');

  const sufixo = Date.now();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'validacao-real',
      slug: `validacao-real-${sufixo}`,
      createdBy: owner.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: owner.id, role: 'owner' });

  log(`projeto: ${project.id}`);
  assertar(
    project.storyPromotion === 'manual',
    `projeto novo nasceu em "${project.storyPromotion}"; o default é "manual"`,
  );
  log('✓ promoção MANUAL por default (RN-048)');

  const adocao = await app
    .get(AdoptRepositoryUseCase)
    .execute(project.id, owner.id, { provider: 'github', externalId: repo });

  assertar(
    adocao.repository.origin === 'adopted',
    `origin deveria ser "adopted", veio "${adocao.repository.origin}"`,
  );
  log(
    `✓ adotado do GitHub: ${repo} · origin=${adocao.repository.origin} · branch padrão=${adocao.repository.defaultBranch ?? '(nenhuma — repo vazio)'}`,
  );

  log(`✓ plano: ${adocao.plan.steps.length} mutação(ões) que o Brabo FARIA`);
  for (const passo of adocao.plan.steps) {
    log(`    ${passo.step.padEnd(24)} ${passo.actionType}`);
  }
  for (const d of adocao.plan.diagnostics) {
    log(`    diagnóstico: ${d.kind} ${JSON.stringify(d.detail)}`);
  }

  const bootstrapAntes = await db
    .select()
    .from(repoBootstraps)
    .where(eq(repoBootstraps.projectId, project.id));
  assertar(
    bootstrapAntes.every((b) => b.planDecision === null),
    'a decisão do plano deveria estar NULA antes de o usuário decidir (RN-045)',
  );
  log('✓ decisão NULA — nada foi alterado no repositório remoto (RN-045)');

  const [repoRow] = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, project.id));
  assertar(
    repoRow?.origin === 'adopted' && repoRow.externalId === repo,
    'a linha de repositório não reflete a adoção remota',
  );
  log('✓ ZERO seed manual: as linhas nasceram do caso de uso');

  if (ate === 'adocao') {
    log(
      `\n[validacao-real] parou em "adocao" como pedido.\n` +
        `projeto: ${project.id}\n` +
        `plano gerado em: ${String(adocao.plan.generatedAt)}\n` +
        `\nA decisão do plano NÃO foi tomada — o repositório remoto está intocado.`,
    );
    await app.close();
    return;
  }

  // A partir daqui o Brabo ESCREVE no repositório do usuário.
  await app.get(DecideBootstrapPlanUseCase).adoptAsIs(project.id, owner.id, {
    planGeneratedAt: adocao.plan.generatedAt,
  });
  log('✓ adotado COMO ESTÁ — o template não foi forçado sobre o repo remoto');

  log(
    '\n[validacao-real] as fases `backlog` e `execucao` ainda não estão implementadas.',
  );
  await app.close();
}

main().catch((error) => {
  console.error(`\nValidação falhou: ${String(error)}`);
  process.exit(1);
});
