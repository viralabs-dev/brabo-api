import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertNoCycle,
  ModuleCycleError,
  type ModuleNode,
} from '../../../domain/architecture/module-graph';
import { missingModules } from '../../../domain/architecture/module-resolution';
import {
  derivarRecursosMinimos,
  RecursosDoModuloInvalidosError,
  validarRecursosDoModulo,
  validarSomaNoTeto,
} from '../../../domain/containers/recursos-minimos';

export interface CreateModuleMapInput {
  modules: ModuleNode[];
}

/**
 * Cria/atualiza o module_map do projeto (tool create_module_map do Arquiteto).
 * Rejeita mapas com CICLO de dependência (validação de domínio). Ao criar o
 * novo mapa, REVALIDA todas as stories `ready`: as que passam a referenciar um
 * módulo que sumiu são rebaixadas a `draft` (com evento — que é a notificação
 * no feed). Emite `artifact.module_map`.
 *
 * Desde a RN-683 (ADR 0199) cada módulo pode declarar `resources` — o que ele
 * precisa sozinho dentro do container —, e é daí que a Infra deriva o mínimo
 * da subida. A declaração é validada AQUI (os três campos ou nenhum, cada um
 * no teto, e a SOMA no teto, porque todos dividem um container): a recusa
 * volta ao Arquiteto, que é quem pode corrigir, e não estoura depois na subida.
 */
@Injectable()
export class CreateModuleMapUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly stories: StoryRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CreateModuleMapInput,
  ) {
    let modules: ModuleNode[];
    try {
      assertNoCycle(input.modules);
      modules = input.modules.map(normalizarModulo);
      validarSomaNoTeto(derivarRecursosMinimos(modules));
    } catch (e) {
      if (
        e instanceof ModuleCycleError ||
        e instanceof RecursosDoModuloInvalidosError
      ) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const current = await this.moduleMaps.findCurrent(projectId);

    // Um mapa POR SESSÃO. Versionar entre sessões é desejado — arquitetura se
    // revisa —, mas dentro da MESMA sessão a segunda emissão nunca é revisão:
    // é o modelo redecidindo do zero. Numa execução real o Arquiteto emitiu
    // quatro mapas seguidos, com nomes e recortes diferentes a cada volta
    // (`greeting`, `hello_core`, `greeting`, `hello-api-core`), e só parou
    // porque a rede caiu.
    //
    // A recusa volta ao modelo pelo tool-result (RN-061): ele lê que já existe
    // e segue para o passo 2 do kickoff, em vez de reabrir o passo 1.
    if (current && current.sessionId === sessionId) {
      // A recusa diz os NOMES, não só a contagem. Na execução que motivou este
      // guarda, o Arquiteto leu "2 módulos", não soube quais, e reemitiu o mapa
      // justamente para tentar fixar nomes que não conseguia ler — o laço era
      // sintoma da cegueira, não a doença.
      throw new ConflictException(
        `Esta sessão já definiu o module_map (versão ${current.version}), ` +
          `com os módulos: ${current.modules.map((m) => m.name).join(', ')}. ` +
          `Siga para assign_story_modules usando esses nomes.`,
      );
    }

    const map = await this.moduleMaps.create({
      projectId,
      sessionId,
      modules,
      version: (current?.version ?? 0) + 1,
    });

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'artifact.module_map',
      actor: { kind: 'agent', id: 'arquiteto' },
      payload: {
        moduleMapId: map.id,
        version: map.version,
        modules: map.modules,
      },
    });

    // Revalidação: rebaixa stories `ready` que ficaram órfãs.
    const names = map.modules.map((m) => m.name);
    const readyStories = (await this.stories.findByProject(projectId)).filter(
      (s) => s.status === 'ready',
    );
    for (const story of readyStories) {
      const missing = missingModules(story.moduleIds, names);
      if (missing.length > 0) {
        await this.stories.updateStatus(story.id, 'draft');
        await this.appendEvent.execute(projectId, sessionId, {
          type: 'backlog.story_demoted',
          actor: { kind: 'system', id: 'module-map-revalidation' },
          payload: {
            storyId: story.id,
            title: story.title,
            missingModules: missing,
          },
        });
      }
    }

    return map;
  }
}

// Grava só os campos do contrato, e `resources` só quando declarado — o JSON do
// mapa não guarda o que o modelo mandou a mais, nem `resources: null`.
function normalizarModulo(m: ModuleNode): ModuleNode {
  const resources = validarRecursosDoModulo(m.name, m.resources);
  return {
    name: m.name,
    stack: m.stack,
    responsibility: m.responsibility,
    dependsOn: m.dependsOn ?? [],
    ...(resources ? { resources } : {}),
  };
}
