import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AutomacaoDoProjetoRepository,
  type AutomacaoDoProjeto,
} from '../../ports/automacao-do-projeto-repository.port';
import {
  CATEGORIA_DA_PASSAGEM,
  PASSAGENS_SEM_CLIQUE,
} from '../../../domain/sessions/aceite-automatico-do-handoff';

export type AutomacaoResolvida = Pick<
  AutomacaoDoProjeto,
  'categoria' | 'chave' | 'ligada' | 'origem' | 'userId'
> & { alteradaEm: Date | null };

/**
 * As chaves de automação do projeto (AT-994, RN-1421). Hoje só as passagens
 * Arquiteto→Infra e Infra→Dev Lead; sem linha, a chave vale LIGADA.
 */
@Injectable()
export class AutomacoesDoProjetoUseCase {
  constructor(private readonly repo: AutomacaoDoProjetoRepository) {}

  /** A passagem está ligada? Sem linha, o padrão é ligada. */
  async passagemLigada(projectId: string, chave: string): Promise<boolean> {
    const linhas = await this.repo.listar(projectId);
    return (
      linhas.find(
        (l) => l.categoria === CATEGORIA_DA_PASSAGEM && l.chave === chave,
      )?.ligada ?? true
    );
  }

  async listar(projectId: string): Promise<AutomacaoResolvida[]> {
    const linhas = await this.repo.listar(projectId);
    return PASSAGENS_SEM_CLIQUE.map((chave) => {
      const l = linhas.find(
        (x) => x.categoria === CATEGORIA_DA_PASSAGEM && x.chave === chave,
      );
      return {
        categoria: CATEGORIA_DA_PASSAGEM,
        chave,
        ligada: l?.ligada ?? true,
        origem: l?.origem ?? 'padrao',
        userId: l?.userId ?? null,
        alteradaEm: l?.createdAt ?? null,
      };
    });
  }

  async definir(
    projectId: string,
    userId: string,
    categoria: string,
    chave: string,
    ligada: boolean,
  ): Promise<AutomacaoResolvida[]> {
    if (
      categoria !== CATEGORIA_DA_PASSAGEM ||
      !(PASSAGENS_SEM_CLIQUE as readonly string[]).includes(chave)
    ) {
      throw new BadRequestException(
        `Automação desconhecida: ${categoria}/${chave}`,
      );
    }
    await this.repo.definir({
      projectId,
      categoria,
      chave,
      ligada,
      origem: 'manual',
      userId,
    });
    return this.listar(projectId);
  }
}
