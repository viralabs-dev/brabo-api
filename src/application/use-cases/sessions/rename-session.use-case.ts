import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';

/**
 * Dá (ou tira) o nome amigável de uma sessão — FASE 20, RN-098.
 *
 * ## Por que renomear NÃO é um evento de sessão
 *
 * O event log é o que a sessão VIVEU, e o nome não é um fato do trabalho: é
 * um rótulo de navegação, trocado quantas vezes a pessoa quiser. Gravá-lo como
 * evento poria N eventos de renomeação entre as mensagens do fio e no feed de
 * atividade, empurrando para fora da cauda de 200 exatamente o que interessa.
 * A coluna guarda o valor vigente, e é ela que a tela lê.
 *
 * ## Por que não existe um `changeKind` ao lado
 *
 * Porque `kind` é INTENÇÃO de criação (RN-097). Poder trocá-lo depois o
 * transformaria em estado, e o produto voltaria a ter duas fontes disputando o
 * que é uma sessão de execução — que é o defeito que esta fase existe para não
 * introduzir. Quem quer o outro tipo abre outra sessão; ela custa uma linha.
 */
@Injectable()
export class RenameSessionUseCase {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(projectId: string, sessionId: string, name: string | null) {
    // Branco é ausência de nome, não um nome vazio — mesmo tratamento da
    // criação, e o que faz o rótulo degradar para a hashtag sozinha em vez de
    // virar " · #a1b2c3d4".
    const limpo = name?.trim() || null;

    const session = await this.sessions.rename(projectId, sessionId, limpo);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }
}
