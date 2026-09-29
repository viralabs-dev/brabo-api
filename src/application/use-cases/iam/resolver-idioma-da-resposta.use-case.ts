import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../ports/user-repository.port';
import { SessionLanguageOverrideRepository } from '../../ports/session-language-override-repository.port';
import type { UserLocale } from '../../../domain/iam/user.entity';
import {
  IDIOMA_AUTOMATICO,
  resolverIdiomaDaResposta,
  type OrigemDoIdiomaDaResposta,
} from '../../../domain/iam/idioma-de-resposta';

/**
 * A cadeia inteira, e não só o vencedor: a tela mostra de onde veio o valor
 * e o que ficou por baixo (RN-620, no molde da RN-470), e quem consome para
 * mandar ao modelo (AT-164) lê só `idioma`.
 */
export interface IdiomaDaRespostaDaPessoa {
  idioma: string;
  origem: OrigemDoIdiomaDaResposta;
  fontes: {
    /** `null` quando não se perguntou por sessão ou nada foi fixado nela. */
    sessao: string | null;
    /** `'automatico'` ou o código escolhido na Conta. */
    conta: string;
    detectado: string | null;
    detectadoConfirmadoEm: Date | null;
    interface: UserLocale;
  };
}

/**
 * Resolve o idioma em que os agentes respondem a UMA pessoa (RN-618) — com
 * `sessionId`, considerando o que ela fixou naquela sessão; sem, só a conta
 * (é a leitura da página de Conta).
 *
 * É o ponto único que a AT-164 chama para o turno com autor humano: ela passa
 * o AUTOR da mensagem e a sessão, e manda `idioma` ao engine. Turno SEM autor
 * não passa por aqui — usa o idioma do projeto (AT-169 resposta 1).
 *
 * Não valida que a sessão é do projeto nem que existe: quem chama pela rota
 * já passou por `findInProject`, e um `sessionId` sem linha de override
 * apenas não tem override.
 */
@Injectable()
export class ResolverIdiomaDaRespostaUseCase {
  constructor(
    private readonly usuarios: UserRepository,
    private readonly overrides: SessionLanguageOverrideRepository,
  ) {}

  async execute(
    userId: string,
    sessionId: string | null = null,
  ): Promise<IdiomaDaRespostaDaPessoa> {
    const usuario = await this.usuarios.findById(userId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
    const sessao = sessionId
      ? await this.overrides.find(sessionId, userId)
      : null;

    const { idioma, origem } = resolverIdiomaDaResposta({
      sessao,
      conta: usuario.responseLanguage,
      detectadoConfirmado: usuario.detectedLanguage,
      interface: usuario.locale,
    });

    return {
      idioma,
      origem,
      fontes: {
        sessao,
        conta: usuario.responseLanguage ?? IDIOMA_AUTOMATICO,
        detectado: usuario.detectedLanguage,
        detectadoConfirmadoEm: usuario.detectedLanguageConfirmedAt,
        interface: usuario.locale,
      },
    };
  }
}
