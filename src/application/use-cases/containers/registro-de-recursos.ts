import { Injectable, Logger } from '@nestjs/common';
import {
  RecursoDeProjetoRepository,
  type TipoDeRecurso,
} from '../../ports/recurso-de-projeto-repository.port';

/**
 * AT-980 (ADR 0298, RN-1382): escreve no inventário `project_resources` o que a
 * api pediu ao broker e o resultado. Falha de gravar vira log e a ação segue: a
 * reconciliação cobre o buraco (o host é a verdade do que existe).
 */
@Injectable()
export class RegistroDeRecursos {
  private readonly log = new Logger(RegistroDeRecursos.name);

  constructor(private readonly repo: RecursoDeProjetoRepository) {}

  private async tentar(o: string, f: () => Promise<unknown>): Promise<void> {
    try {
      await f();
    } catch (e) {
      this.log.error(
        `registro de recursos (${o}) não gravado: ${(e as Error).message}`,
      );
    }
  }

  /** ANTES de `start`/`startQa`. */
  pedido(
    projectId: string,
    tipo: TipoDeRecurso,
    chave = '',
    portas: unknown[] = [],
  ) {
    return this.tentar('pedido', () =>
      this.repo.gravar(projectId, tipo, chave, { estado: 'pedido', portas }),
    );
  }

  criado(
    projectId: string,
    tipo: TipoDeRecurso,
    chave = '',
    containerId: string | null = null,
  ) {
    return this.tentar('criado', () =>
      this.repo.gravar(projectId, tipo, chave, {
        estado: 'criado',
        containerId,
      }),
    );
  }

  falhou(
    projectId: string,
    tipo: TipoDeRecurso,
    chave: string,
    motivo: string,
  ) {
    return this.tentar('falhou', () =>
      this.repo.gravar(projectId, tipo, chave, { estado: 'falhou', motivo }),
    );
  }

  /** DEPOIS de `remove`/`removeQa` com sucesso. */
  removido(projectId: string, tipo: TipoDeRecurso, chave = '') {
    return this.tentar('removido', () =>
      this.repo.gravar(projectId, tipo, chave, { estado: 'removido' }),
    );
  }
}
