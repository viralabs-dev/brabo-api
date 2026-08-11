import { BadRequestException, Injectable } from '@nestjs/common';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import {
  EVENTO_IMAGEM_DO_PROJETO,
  ImagemInvalidaError,
  validarDecisaoDeImagem,
  type DecisaoDeImagem,
  type DecisaoDeImagemInput,
} from '../../../domain/containers/project-container';

export interface ImagemDecidida {
  decisao: DecisaoDeImagem;
  version: number;
}

/**
 * O Arquiteto decide qual imagem sobe para o projeto (FASE 25a, ADR 0065).
 *
 * ## Sem tabela, e não por economia
 *
 * O artefato É o evento. `artifact.project_image` no event log dá de graça as
 * três propriedades que a decisão precisa ter — imutável, versionado e com
 * autor —, e é o mesmo lugar onde `artifact.module_map` e
 * `artifact.business_rule` já moram. Uma tabela daria a mesma coisa com um
 * UPDATE possível, e UPDATE em decisão de arquitetura é a forma de ela deixar
 * de ser auditável.
 *
 * ## Revisar é emitir de novo
 *
 * A versão nova não apaga a anterior: o vigente é o de maior `version`, e o
 * histórico continua legível. Trocar a imagem de um projeto que já rodou tem
 * consequência (o container precisa ser reciclado), e por isso o rastro de
 * QUANDO ela mudou vale mais do que a economia de uma linha.
 *
 * Diferente do `module_map`, NÃO há trava de uma emissão por sessão: aqui a
 * reemissão é reação legítima a um fato novo (a stack mudou, a imagem foi
 * descontinuada), e o mapa tinha uma trava por causa de um laço observado que
 * não se aplica a uma escolha de uma linha.
 */
@Injectable()
export class DecidirImagemDoProjetoUseCase {
  constructor(
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly obterContainer: ObterContainerDoProjetoUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: DecisaoDeImagemInput,
    decidedBy = 'arquiteto',
  ): Promise<ImagemDecidida> {
    let decisao: DecisaoDeImagem;
    try {
      decisao = validarDecisaoDeImagem(input);
    } catch (e) {
      // A recusa volta ao modelo pelo tool-result (RN-061) com o motivo
      // inteiro: é o que faz ele corrigir em vez de repetir.
      if (e instanceof ImagemInvalidaError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const atual = await this.obterContainer.execute(projectId);
    const version = atual.version + 1;

    await this.appendEvent.execute(projectId, sessionId, {
      type: EVENTO_IMAGEM_DO_PROJETO,
      actor: { kind: 'agent', id: decidedBy },
      payload: { ...decisao, version },
    });

    return { decisao, version };
  }
}
