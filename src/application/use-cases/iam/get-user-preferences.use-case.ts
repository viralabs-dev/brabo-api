import { Injectable } from '@nestjs/common';
import type { UserLocale } from '../../../domain/iam/user.entity';
import type { OrigemDoIdiomaDaResposta } from '../../../domain/iam/idioma-de-resposta';
import { ResolverIdiomaDaRespostaUseCase } from './resolver-idioma-da-resposta.use-case';

/**
 * As preferências do próprio usuário, na forma da rota
 * `users/me/preferences`: o idioma da INTERFACE (Onda 6a) e, desde a RN-618,
 * o idioma das RESPOSTAS dos agentes — os dois lado a lado e nunca fundidos.
 */
export interface PreferenciasDoUsuario {
  locale: UserLocale;
  /** `'automatico'` ou um código BCP-47 canônico. */
  responseLanguage: string;
  detectedLanguage: string | null;
  detectedLanguageConfirmedAt: Date | null;
  /** O que vale HOJE fora de sessão, e de onde veio (sem override). */
  effectiveResponseLanguage: {
    language: string;
    origin: OrigemDoIdiomaDaResposta;
  };
}

export async function preferenciasDoUsuario(
  resolver: ResolverIdiomaDaRespostaUseCase,
  userId: string,
): Promise<PreferenciasDoUsuario> {
  const r = await resolver.execute(userId);
  return {
    locale: r.fontes.interface,
    responseLanguage: r.fontes.conta,
    detectedLanguage: r.fontes.detectado,
    detectedLanguageConfirmedAt: r.fontes.detectadoConfirmadoEm,
    effectiveResponseLanguage: { language: r.idioma, origin: r.origem },
  };
}

/**
 * Lê as preferências do próprio usuário (fundação de i18n, Onda 6a; RN-618).
 *
 * O `locale` aqui é redundante com o que já vem no payload de login/refresh
 * (`EmitirSessaoUseCase`), para o caso em que a `AccountPage` precisa
 * reafirmar o valor sem esperar o próximo refresh — ex.: aba aberta há muito
 * tempo, ou depois de um `PATCH` feito em outra aba. O idioma das respostas
 * só vem por aqui.
 */
@Injectable()
export class GetUserPreferencesUseCase {
  constructor(private readonly resolver: ResolverIdiomaDaRespostaUseCase) {}

  execute(userId: string): Promise<PreferenciasDoUsuario> {
    return preferenciasDoUsuario(this.resolver, userId);
  }
}
