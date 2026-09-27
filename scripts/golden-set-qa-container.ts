/**
 * O container de VERDADE de cada caso do golden-set do QA (AT-076, decisão do
 * mantenedor de 2026-09-27: "caminho 1").
 *
 * ## Por que isto existe
 *
 * Desde a RN-502 (ADR 0143), um projeto `container` sem container `running`
 * REGISTRADO tem todo comando de terminal recusado pelo engine. O seed do
 * golden-set (`seed-golden-set-qa.ts`) nasceu em 2026-08-30, antes da regra, e
 * nunca registrava container: o `npm test` que o QA pede era auto-aprovado e
 * RECUSADO, nenhum caso via `exit 0`, e `approved` ficava impossível — 0/6 por
 * construção, medido em CI pela AT-067. A saída escolhida NÃO toca a recusa: o
 * seed sobe o container pelo MESMO caminho de produção, e o `npm test` passa a
 * rodar DENTRO dele (`ContainerBrokerPort.exec`, ADR 0134, RN-492).
 *
 * ## O caminho, e por que proposta + aprovação em vez do caso de uso direto
 *
 * Em produção, quem sobe o container de um projeto `container` é uma ação
 * `container_start` (ADR 0133, RN-491): o Arquiteto define o `module_map` e
 * candidata uma imagem por módulo (`route_modules_to_infra`, ADR 0131), a
 * Infra PROPÕE subir elegendo uma das candidatas, e um humano `maintainer`
 * APROVA. A aprovação chama `ExecuteContainerStartUseCase`, que (a) emite a
 * nova versão de `artifact.project_image` por `DecidirImagemDoProjetoUseCase`
 * (e portanto por `validarDecisaoDeImagem`), (b) pede ao broker o `start` e
 * (c) registra `provisioning → running` pela máquina de estados
 * (`SubirCicloDeVidaDoContainerUseCase` → `RegistrarTransicaoDeContainerUseCase`).
 *
 * Este módulo percorre ESSA sequência, pelos casos de uso — nenhum insert
 * cru, nenhum atalho:
 *
 *   `CreateModuleMapUseCase` → `RouteModulesToInfraUseCase` →
 *   `ProposeActionUseCase` (ator `agent/infra`) → `ApproveActionUseCase`
 *   (o dono do projeto, que é quem a tela deixaria clicar).
 *
 * Chamar `ExecuteContainerStartUseCase` direto pularia DUAS regras que valem
 * para a ação de verdade: a recusa nomeada de instalação sem broker na
 * PROPOSTA (`sem_broker_na_instalacao`, RN-591) e a política de `decide()`
 * (`container_start` exige `maintainer` e nunca é semeado auto-aprovável). Pela
 * proposta, se uma dessas regras mudar, o golden-set muda junto — é o que
 * "fiel à produção" quer dizer aqui. Nenhuma regra é tocada: o seed é um
 * CHAMADOR, com os mesmos direitos de quem clica "Aprovar" na tela.
 *
 * A sessão onde isso acontece é PRÓPRIA (`consultiva`), separada da sessão do
 * QA — em produção a decisão de infraestrutura é de outra sessão que a da
 * execução, e misturar os eventos de arquitetura no log que o QA escreve
 * mudaria o que o caso mede.
 *
 * ## Falha é NOMEADA, nunca 0/6 calado
 *
 * Sem container, o golden-set volta a medir a recusa da RN-502 e não o
 * julgamento do QA — o defeito exato que a AT-067 mediu. Por isso qualquer
 * passo que não termine em `running` LANÇA `ContainerDoGoldenSetNaoSubiuError`,
 * dizendo a ETAPA e o motivo que o próprio produto devolveu, e o seed sai com
 * código 1 antes de o QA gastar um token.
 */
import type { CreateSessionUseCase } from '../src/application/use-cases/sessions/create-session.use-case';
import type { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import type { CreateModuleMapUseCase } from '../src/application/use-cases/architecture/create-module-map.use-case';
import type { RouteModulesToInfraUseCase } from '../src/application/use-cases/architecture/route-modules-to-infra.use-case';
import type { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import type { ApproveActionUseCase } from '../src/application/use-cases/actions/approve-action.use-case';
import type { ObterCicloDeVidaDoContainerUseCase } from '../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import type { ProposedAction } from '../src/domain/actions/proposed-action.entity';
import type { ContainerStartExecutionResult } from '../src/domain/containers/container-start-execution-result';

/**
 * A imagem dos seis casos: Node com `npm`, porque o `AGENTS.md` do esqueleto
 * manda rodar `npm test` (`node --test`, sem dependência nenhuma).
 *
 * Presa por DIGEST do ÍNDICE multiplataforma, com a tag junto — a mesma régua
 * do ADR 0159 para imagem de terceiro, embora este arquivo não esteja nas
 * três árvores que `scripts/ci/imagens-pinadas.ts` varre. O validador
 * (`validarDecisaoDeImagem`) aceita a forma `nome:tag@sha256:…`: com digest,
 * a referência determina a imagem, que é o que ele exige.
 *
 * `bookworm-slim` e não `alpine`: o broker mantém o container vivo com
 * `sleep infinity` (`packages/docker-port/src/docker-cli.ts`), e o `sleep`
 * do coreutils aceita `infinity` sem depender da versão do busybox.
 */
export const IMAGEM_DO_GOLDEN_SET_QA =
  'node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57';

/** Único módulo do esqueleto — o roteamento exige módulo do `module_map` vigente. */
const MODULO = 'app';

/**
 * `none`: o `npm test` dos casos não baixa nada (Node puro, AGENTS.md proíbe
 * `npm install`), então a postura default do ADR 0065 basta. Recursos
 * pequenos de propósito: o job de CI divide a máquina com o Ollama.
 */
const RECURSOS = { cpus: 1, memoryMb: 1024, pidsLimit: 256 };

export type EtapaDaSubida =
  | 'module_map'
  | 'roteamento'
  | 'proposta'
  | 'aprovacao'
  | 'ciclo_de_vida';

export class ContainerDoGoldenSetNaoSubiuError extends Error {
  readonly etapa: EtapaDaSubida;

  constructor(casoId: string, etapa: EtapaDaSubida, motivo: string) {
    super(
      `golden-set QA, caso ${casoId}: o container do projeto NÃO subiu ` +
        `(etapa: ${etapa}) — ${motivo}. Sem container \`running\` registrado ` +
        'o engine recusa todo `npm test` (RN-502) e o golden-set mediria a ' +
        'recusa, não o julgamento do QA; por isso o seed para aqui. O broker ' +
        'precisa estar de pé (BROKER_URL na api, PROJECT_WORKSPACES_HOST_ROOT ' +
        'no broker apontando para a mesma pasta que PROJECT_WORKSPACES_ROOT) ' +
        `e a imagem ${IMAGEM_DO_GOLDEN_SET_QA} já presente no daemon.`,
    );
    this.name = 'ContainerDoGoldenSetNaoSubiuError';
    this.etapa = etapa;
  }
}

export interface DependenciasDaSubida {
  createSession: Pick<CreateSessionUseCase, 'execute'>;
  transitionSession: Pick<TransitionSessionUseCase, 'execute'>;
  createModuleMap: Pick<CreateModuleMapUseCase, 'execute'>;
  routeModulesToInfra: Pick<RouteModulesToInfraUseCase, 'execute'>;
  proposeAction: Pick<ProposeActionUseCase, 'execute'>;
  approveAction: Pick<ApproveActionUseCase, 'execute'>;
  obterCicloDeVida: Pick<ObterCicloDeVidaDoContainerUseCase, 'execute'>;
}

export interface ContainerDoCaso {
  /** A sessão `consultiva` onde a decisão de infraestrutura foi tomada. */
  infraSessionId: string;
  actionId: string;
  containerId: string;
}

/**
 * Sobe o container do projeto de UM caso. Pré-condição: a pasta do projeto já
 * tem o código (o clone vem ANTES — o daemon criaria a pasta vazia, como
 * `root`, se o bind-mount chegasse primeiro, e o clone depois não teria onde
 * escrever).
 */
export async function subirContainerDoCaso(
  deps: DependenciasDaSubida,
  entrada: { casoId: string; projectId: string; userId: string },
): Promise<ContainerDoCaso> {
  const { casoId, projectId, userId } = entrada;

  const sessao = await deps.createSession.execute(projectId, userId, {
    kind: 'consultiva',
    name: `golden-set QA — infraestrutura (${casoId})`,
  });
  await deps.transitionSession.execute(projectId, sessao.id, 'active');

  await etapa(casoId, 'module_map', () =>
    deps.createModuleMap.execute(projectId, sessao.id, {
      modules: [
        {
          name: MODULO,
          stack: 'Node.js puro (node:test), sem dependências',
          responsibility: 'o código e a suíte do caso do golden-set',
          dependsOn: [],
        },
      ],
    }),
  );

  await etapa(casoId, 'roteamento', () =>
    deps.routeModulesToInfra.execute(projectId, sessao.id, {
      roteamento: [
        {
          modulo: MODULO,
          imagemCandidata: IMAGEM_DO_GOLDEN_SET_QA,
          porque:
            'Node com npm para rodar `npm test` (node --test), como o AGENTS.md do repositório manda.',
        },
      ],
    }),
  );

  const proposta = await etapa(casoId, 'proposta', () =>
    deps.proposeAction.execute(projectId, sessao.id, {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: {
        imagem: IMAGEM_DO_GOLDEN_SET_QA,
        network: 'none',
        resources: RECURSOS,
        rationale:
          'Golden-set do QA: a única candidata do roteamento, suficiente para `npm test` sem rede.',
      },
    }),
  );

  // `pending` é o esperado (`container_start` nunca é semeado auto-aprovável);
  // `auto_approved` já executou dentro da proposta e só é lido. Qualquer outro
  // estado (`denied`) é a política recusando, e a frase dela vai junto.
  let acao: ProposedAction = proposta;
  if (proposta.status === 'pending') {
    acao = await etapa(casoId, 'aprovacao', () =>
      deps.approveAction.execute(projectId, sessao.id, proposta.id, userId),
    );
  } else if (proposta.status !== 'auto_approved') {
    throw new ContainerDoGoldenSetNaoSubiuError(
      casoId,
      'proposta',
      `a política resolveu \`${proposta.status}\`` +
        (proposta.rejectionReason ? ` (${proposta.rejectionReason})` : ''),
    );
  }

  const resultado = acao.executionResult as ContainerStartExecutionResult | null;
  if (acao.status !== 'executed' || !resultado?.containerId) {
    throw new ContainerDoGoldenSetNaoSubiuError(
      casoId,
      'aprovacao',
      `a ação container_start terminou \`${acao.status}\`: ` +
        (resultado?.motivo ?? 'sem motivo registrado'),
    );
  }

  // A pergunta que o ENGINE faz antes de cada comando (RN-502) é esta — a
  // linha REGISTRADA em `project_containers` —, então é ela que o seed confere,
  // e não a resposta do broker.
  const ciclo = await deps.obterCicloDeVida.execute(projectId);
  if (ciclo?.status !== 'running') {
    throw new ContainerDoGoldenSetNaoSubiuError(
      casoId,
      'ciclo_de_vida',
      `o broker respondeu, mas o ciclo de vida registrado é ` +
        `\`${ciclo?.status ?? 'nenhum'}\`, não \`running\``,
    );
  }

  return {
    infraSessionId: sessao.id,
    actionId: acao.id,
    containerId: resultado.containerId,
  };
}

/**
 * Roda um passo e, se ele LANÇA (a api recusando com 409/400 nomeado, como
 * `sem_broker_na_instalacao`), converte na recusa com a etapa — preservando a
 * mensagem que o produto escreveu.
 */
async function etapa<T>(
  casoId: string,
  nome: EtapaDaSubida,
  passo: () => Promise<T>,
): Promise<T> {
  try {
    return await passo();
  } catch (erro) {
    if (erro instanceof ContainerDoGoldenSetNaoSubiuError) throw erro;
    throw new ContainerDoGoldenSetNaoSubiuError(casoId, nome, descrever(erro));
  }
}

function descrever(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'getResponse' in erro) {
    const resposta = (erro as { getResponse: () => unknown }).getResponse();
    if (resposta && typeof resposta === 'object') {
      const { code, message } = resposta as { code?: unknown; message?: unknown };
      const texto = typeof message === 'string' ? message : JSON.stringify(message);
      return typeof code === 'string' ? `${code}: ${texto}` : texto;
    }
  }
  return erro instanceof Error ? erro.message : String(erro);
}
