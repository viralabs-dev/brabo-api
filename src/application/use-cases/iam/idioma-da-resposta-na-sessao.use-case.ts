import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionLanguageOverrideRepository } from '../../ports/session-language-override-repository.port';
import {
  ResolverIdiomaDaRespostaUseCase,
  type IdiomaDaRespostaDaPessoa,
} from './resolver-idioma-da-resposta.use-case';
import { idiomaDaRespostaOuRecusa } from './update-user-preferences.use-case';

/**
 * O idioma das respostas de UMA pessoa numa sessão (RN-618): ler o efetivo,
 * com a cadeia inteira, e fixar ou soltar o override daquela sessão.
 *
 * O override é SÓ de quem chama — o `userId` vem do token, nunca do corpo, e
 * não há rota para ler ou mexer no de outro participante: é preferência
 * pessoal que por acaso tem escopo de sessão, não configuração da sessão.
 */
@Injectable()
export class IdiomaDaRespostaNaSessaoUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly overrides: SessionLanguageOverrideRepository,
    private readonly resolver: ResolverIdiomaDaRespostaUseCase,
  ) {}

  async ler(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<IdiomaDaRespostaDaPessoa> {
    await this.exigirSessao(projectId, sessionId);
    return this.resolver.execute(userId, sessionId);
  }

  /**
   * `language: null` (ou `'automatico'`) solta o override e a pessoa volta a
   * herdar da Conta; qualquer outro valor passa pela MESMA régua BCP-47 da
   * Conta. Fixar numa sessão ENCERRADA é permitido: não dispara turno nem
   * escreve no event log, e recusar só tornaria a tela incoerente com o que
   * ela mostra.
   */
  async definir(
    projectId: string,
    sessionId: string,
    userId: string,
    language: string | null,
  ): Promise<IdiomaDaRespostaDaPessoa> {
    const canonico =
      language === null ? null : idiomaDaRespostaOuRecusa(language);
    await this.exigirSessao(projectId, sessionId);
    if (canonico === null) {
      await this.overrides.clear(sessionId, userId);
    } else {
      await this.overrides.set(sessionId, userId, canonico);
    }
    return this.resolver.execute(userId, sessionId);
  }

  private async exigirSessao(projectId: string, sessionId: string) {
    const sessao = await this.sessions.findInProject(projectId, sessionId);
    if (!sessao) throw new NotFoundException('Sessão não encontrada');
  }
}
