import { describe, it, expect, vi } from 'vitest';
import { ExecuteContainerStartViaRunnerUseCase } from '../../src/application/use-cases/actions/execute-container-start-via-runner.use-case';
import { RECURSOS_PADRAO } from '../../src/domain/containers/project-container';
import type { EspecificacaoDeContainerParaRunner } from '../../src/application/ports/api-to-engine-client.port';
import type { ProposedAction } from '../../src/domain/actions/proposed-action.entity';
// O VALIDADOR REAL do runner, por caminho RELATIVO — ver o docblock abaixo.
import { especificacaoValidada } from '../../../../packages/docker-port/src/spec-de-container.ts';

/**
 * A CORRENTE de `container_start_via_runner` (RN-508, ADR 0145): o payload que
 * `ExecuteContainerStartViaRunnerUseCase` COMPÕE, validado pelo
 * `especificacaoValidada` de VERDADE — o mesmo que roda dentro do
 * `brabo-runner`, na máquina do usuário.
 *
 * ## Por que este teste existe
 *
 * Porque três suítes verdes deixaram passar um defeito que tornava o caminho
 * inteiro impossível: `EspecificacaoDeContainerParaRunner` nasceu com NOVE
 * campos, sem `projectId`, e `especificacaoValidada` sempre exigiu DEZ. Toda
 * `container_start_via_runner` aprovada terminava `failed` com
 *
 *     especificação de container recusada em `projectId`:
 *     esperava texto não vazio, recebi undefined
 *
 * e daí em diante o bloqueio CORRETO da RN-507/RN-502 fazia o resto: sem
 * container REGISTRADO `running`, nenhum dev agent reivindicava tarefa.
 *
 * O elo da api passava (o teste do caso de uso monta o próprio esperado); o
 * elo do runner passava (`index-handlers.spec.ts` monta o próprio fixture,
 * COM `projectId`); o elo do engine nem olha o mapa, repassa opaco. Ninguém
 * testava a corrente — o objeto que a api de fato compõe, contra o validador
 * que de fato o recebe.
 *
 * ## Por que ele mora AQUI, e por caminho relativo
 *
 * Ele precisa dos DOIS lados vivos ao mesmo tempo, e só um lugar tem os dois:
 * a suíte da api, que é onde o caso de uso roda. O contrário não existe —
 * `packages/docker-port` e `apps/runner` não podem importar um caso de uso
 * do NestJS, e inverter a dependência (o pacote de runtime do broker/runner
 * dependendo da api) seria muito pior do que o defeito que este teste pega.
 *
 * O import é RELATIVO e não `@brabo/docker-port` de propósito, e isso NÃO
 * afrouxa o invariante de `test/api-nao-consome-docker-port.spec.ts` — ele
 * proíbe a api DEPENDER do pacote, porque `pnpm --filter api --prod --legacy
 * deploy /prod` (docker/api/Dockerfile.prod:52) copiaria o pacote de verdade
 * para `node_modules` e o Node morreria no boot com
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Nada disso pode acontecer a
 * partir daqui:
 *
 * - nenhum manifesto ganha uma linha (o invariante testa exatamente isso, e
 *   segue verde);
 * - `--prod` já excluiria devDependency, mas nem existe devDependency;
 * - `tsconfig.build.json` exclui `test/`, então nada disto entra no `dist`;
 * - o `Dockerfile.prod` copia `dist` e as deps de produção, nunca `test/`.
 *
 * O invariante irmão foi ESTENDIDO na mesma entrega para cobrir o import
 * relativo a partir de `src/` — que é o que de fato quebraria a produção, e
 * que antes nem o `git grep` por nome de pacote pegava.
 */

const RAIZ_DO_PROJETO_NA_MAQUINA_DO_USUARIO = '/home/dev/projetos-brabo/exp004';

/**
 * O `SpecDeContainer` que `ObterSpecDeContainerUseCase` devolve para um
 * projeto `runner` — os mesmos campos e os mesmos formatos, incluindo o
 * `localizacao: indisponivel` que é o estado NORMAL desse modo (a pasta mora
 * numa máquina que este servidor não enxerga).
 */
function specDoProjeto() {
  return {
    projectId: 'proj-exp004',
    projectSlug: 'exp004',
    workspaceId: 'ws-1',
    workspaceDirName: 'exp004-a1b2c3d4',
    executionMode: 'runner' as const,
    localizacao: {
      tipo: 'indisponivel' as const,
      motivo: 'o projeto está no modo "runner"',
    },
    imagem: {
      image: 'node:22-bookworm-slim',
      network: 'none' as const,
      resources: RECURSOS_PADRAO,
    },
    imagemVersao: 3,
  };
}

function makeAction(): ProposedAction {
  return {
    id: 'pa-1',
    projectId: 'proj-exp004',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'container_start_via_runner',
    payload: { rationale: 'subir agora' },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'infra' },
    decidedBy: 'user-1',
    decidedAt: new Date(),
    rejectionReason: null,
    executionResult: null,
  } as unknown as ProposedAction;
}

/**
 * Roda o caso de uso REAL e devolve o payload que ele entregou ao
 * `ApiToEngineClient` — o objeto que o engine repassa OPACAMENTE ao runner
 * (`ContainerCommandController.start/2` não filtra campo nenhum).
 */
async function payloadCompostoPelaApi(): Promise<EspecificacaoDeContainerParaRunner> {
  const startContainerViaRunner = vi.fn(async () => ({
    containerId: 'container-1',
    nome: 'brabo-exp004-a1b2c3d4',
    jaEstavaDePe: false,
  }));

  const useCase = new ExecuteContainerStartViaRunnerUseCase(
    { runInTransaction: async (fn: () => unknown) => fn() } as never,
    {
      updateExecutionResult: async (
        _id: string,
        input: { status: string; executionResult: unknown },
      ) => ({ ...makeAction(), ...input }),
    } as never,
    { execute: async () => undefined } as never,
    { append: async () => undefined } as never,
    { execute: async () => specDoProjeto() } as never,
    { startContainerViaRunner } as never,
    { execute: async () => undefined } as never,
  );

  await useCase.execute('proj-exp004', 'sess-1', makeAction());

  expect(startContainerViaRunner).toHaveBeenCalledTimes(1);
  return startContainerViaRunner.mock
    .calls[0]![1] as unknown as EspecificacaoDeContainerParaRunner;
}

describe('a corrente api -> engine -> runner de container_start_via_runner', () => {
  it('o payload que a api compõe atravessa `especificacaoValidada` de verdade', async () => {
    const payload = await payloadCompostoPelaApi();

    // Exatamente o que `tratarContainerStart` faz do outro lado
    // (`apps/runner/src/index.ts`): o mapa que veio pelo canal, mais a raiz
    // que só o runner conhece.
    const validada = especificacaoValidada({
      ...payload,
      raizDoProjeto: RAIZ_DO_PROJETO_NA_MAQUINA_DO_USUARIO,
    });

    expect(validada.projectId).toBe('proj-exp004');
    expect(validada.workspaceDirName).toBe('exp004-a1b2c3d4');
    expect(validada.imagem).toBe('node:22-bookworm-slim');
    // `imagemVersao` entra número e sai TEXTO — a conversão é do validador,
    // e o rótulo `brabo.image.version` depende dela.
    expect(validada.imagemVersao).toBe('3');
    expect(validada.rede).toBe('none');
    expect(validada.cpus).toBe(RECURSOS_PADRAO.cpus);
    expect(validada.memoriaMb).toBe(RECURSOS_PADRAO.memoryMb);
    expect(validada.pidsLimit).toBe(RECURSOS_PADRAO.pidsLimit);
  });

  it('`raizDoProjeto` é o ÚNICO campo que a api não manda', async () => {
    const payload = await payloadCompostoPelaApi();

    const validada = especificacaoValidada({
      ...payload,
      raizDoProjeto: RAIZ_DO_PROJETO_NA_MAQUINA_DO_USUARIO,
    });

    // Um campo NOVO em `EspecificacaoDeContainer` que a api não passe a mandar
    // reprova aqui, mesmo que ele tivesse default — que é a próxima
    // divergência de campo, e o motivo de este teste existir. Ninguém do lado
    // servidor manda caminho de host: `raizDoProjeto` é do runner, e só dele.
    expect(new Set(Object.keys(validada))).toEqual(
      new Set([...Object.keys(payload), 'raizDoProjeto']),
    );
  });
});
