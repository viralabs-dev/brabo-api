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
 * As chaves de automação do projeto (AT-994, RN-1421). As passagens
 * Arquiteto→Infra e Infra→Dev Lead nascem LIGADAS sem linha; as regras que o
 * Brabo oferece e a pessoa aceita (AT-998, RN-1437) são linhas `origem:
 * 'oferta'` e só valem enquanto a linha existir E estiver ligada.
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

  /** A regra aceita da oferta está ligada? Sem linha, não vale (RN-1437). */
  async regraDaOfertaLigada(
    projectId: string,
    categoria: string,
    chave: string,
  ): Promise<AutomacaoResolvida | null> {
    const l = (await this.repo.listar(projectId)).find(
      (x) => x.categoria === categoria && x.chave === chave && x.ligada,
    );
    if (!l) return null;
    return {
      categoria,
      chave,
      ligada: true,
      origem: l.origem,
      userId: l.userId,
      alteradaEm: l.createdAt,
    };
  }

  /** Grava a regra que a pessoa aceitou da oferta (`origem: 'oferta'`). */
  async gravarRegraDaOferta(
    projectId: string,
    userId: string,
    categoria: string,
    chave: string,
  ): Promise<void> {
    await this.repo.definir({
      projectId,
      categoria,
      chave,
      ligada: true,
      origem: 'oferta',
      userId,
    });
  }

  async listar(projectId: string): Promise<AutomacaoResolvida[]> {
    const linhas = await this.repo.listar(projectId);
    const extras: AutomacaoResolvida[] = linhas
      .filter(
        (l) =>
          !(
            l.categoria === CATEGORIA_DA_PASSAGEM &&
            (PASSAGENS_SEM_CLIQUE as readonly string[]).includes(l.chave)
          ),
      )
      .map((l) => ({
        categoria: l.categoria,
        chave: l.chave,
        ligada: l.ligada,
        origem: l.origem,
        userId: l.userId,
        alteradaEm: l.createdAt,
      }));
    const passagens = PASSAGENS_SEM_CLIQUE.map((chave) => {
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
    return [...passagens, ...extras];
  }

  async definir(
    projectId: string,
    userId: string,
    categoria: string,
    chave: string,
    ligada: boolean,
  ): Promise<AutomacaoResolvida[]> {
    const conhecida =
      (categoria === CATEGORIA_DA_PASSAGEM &&
        (PASSAGENS_SEM_CLIQUE as readonly string[]).includes(chave)) ||
      (await this.repo.listar(projectId)).some(
        (l) => l.categoria === categoria && l.chave === chave,
      );
    if (!conhecida) {
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
