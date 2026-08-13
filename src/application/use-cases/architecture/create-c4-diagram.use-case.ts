import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { GetC4DiagramUseCase } from './get-c4-diagram.use-case';
import {
  C4DiagramaInvalidoError,
  EVENTO_C4_DIAGRAM,
  gerarDiagramaContainer,
  gerarDiagramaContexto,
  validarEntradaC4,
  type C4Diagrama,
  type EntradaC4,
  type EntradaC4Input,
} from '../../../domain/architecture/c4-diagram';

export interface C4DiagramaGerado {
  diagrama: C4Diagrama;
  version: number;
}

/**
 * Gera o diagrama C4 (Context + Container) da arquitetura do projeto — tool
 * `create_c4_diagram` do Arquiteto.
 *
 * ## Sem tabela, e o mesmo argumento do `project_image` (ADR 0065)
 *
 * O artefato É o evento `artifact.c4_diagram`: imutável, versionado e com
 * autor, ao lado de `artifact.module_map` e `artifact.project_image`.
 * Revisar é emitir de novo — a versão anterior não é apagada.
 *
 * ## O Container NÃO é redigitado pelo modelo
 *
 * Diferente do Context (atores externos, julgamento do Arquiteto), os
 * containers vêm do `module_map` VIGENTE do projeto (mesmos módulos e
 * dependências que `create_module_map` já validou sem ciclo) — o modelo não
 * descreve os módulos de novo aqui. Deixá-lo redigitar arriscaria um
 * diagrama que diverge silenciosamente do mapa real; a fonte de verdade dos
 * containers é o repositório, nunca a memória do modelo sobre o que ele
 * escreveu num turno anterior.
 *
 * Sem module_map vigente, a geração é recusada: não há Container level sem
 * módulos para desenhar.
 */
@Injectable()
export class CreateC4DiagramUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly getC4Diagram: GetC4DiagramUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: EntradaC4Input,
    geradoPor = 'arquiteto',
  ): Promise<C4DiagramaGerado> {
    let entrada: EntradaC4;
    try {
      entrada = validarEntradaC4(input);
    } catch (e) {
      if (e instanceof C4DiagramaInvalidoError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    if (!moduleMap) {
      throw new BadRequestException(
        'Defina o module_map (create_module_map) antes de gerar o diagrama ' +
          'C4 — o nível Container é derivado dele, e sem módulos não há o ' +
          'que desenhar.',
      );
    }

    const contextDiagram = gerarDiagramaContexto(entrada);
    const containerDiagram = gerarDiagramaContainer(entrada, moduleMap.modules);

    const atual = await this.getC4Diagram.execute(projectId);
    const version = atual.version + 1;

    const diagrama: C4Diagrama = {
      systemName: entrada.systemName,
      systemDescription: entrada.systemDescription,
      actors: entrada.actors,
      contextDiagram,
      containerDiagram,
    };

    await this.appendEvent.execute(projectId, sessionId, {
      type: EVENTO_C4_DIAGRAM,
      actor: { kind: 'agent', id: geradoPor },
      payload: { ...diagrama, version },
    });

    return { diagrama, version };
  }
}
