import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRepository } from '../../ports/user-repository.port';
import type { UserLocale } from '../../../domain/iam/user.entity';
import {
  IDIOMA_AUTOMATICO,
  normalizarIdiomaBcp47,
} from '../../../domain/iam/idioma-de-resposta';
import { ResolverIdiomaDaRespostaUseCase } from './resolver-idioma-da-resposta.use-case';
import {
  preferenciasDoUsuario,
  type PreferenciasDoUsuario,
} from './get-user-preferences.use-case';

export interface AlteracaoDePreferencias {
  locale?: UserLocale;
  /** `'automatico'` ou um código BCP-47 (RN-618). */
  responseLanguage?: string;
}

/**
 * O código aceito, canonicalizado, ou `null` para o automático; LANÇA 400
 * com a regra escrita quando o código não é um idioma. Compartilhada com o
 * override de sessão, que recusa pelo mesmo texto.
 */
export function idiomaDaRespostaOuRecusa(valor: string): string | null {
  if (valor === IDIOMA_AUTOMATICO) return null;
  const canonico = normalizarIdiomaBcp47(valor);
  if (canonico === null) {
    throw new BadRequestException(
      `"${valor}" não é um código de idioma BCP-47 reconhecido (ex.: pt-BR, en, es, fr-CA).`,
    );
  }
  return canonico;
}

/**
 * Grava as preferências do próprio usuário (fundação de i18n, Onda 6a;
 * RN-618). Os dois campos são independentes e opcionais — mandar só um não
 * toca o outro, e é por isso que cada um tem a sua porta no repositório: o
 * idioma das respostas NUNCA altera o da interface, e vice-versa.
 *
 * O idioma das respostas é validado AQUI, e não no DTO, porque a régua
 * (`normalizarIdiomaBcp47`) é do domínio e também canonicaliza: `pt-br`
 * chega e `pt-BR` é gravado.
 */
@Injectable()
export class UpdateUserPreferencesUseCase {
  constructor(
    private readonly usuarios: UserRepository,
    private readonly resolver: ResolverIdiomaDaRespostaUseCase,
  ) {}

  async execute(
    userId: string,
    alteracao: AlteracaoDePreferencias,
  ): Promise<PreferenciasDoUsuario> {
    if (
      alteracao.locale === undefined &&
      alteracao.responseLanguage === undefined
    ) {
      throw new BadRequestException(
        'Nada a alterar: mande `locale` e/ou `responseLanguage`.',
      );
    }

    // Valida TUDO antes de gravar qualquer coisa: um `responseLanguage`
    // inválido não pode deixar o `locale` do mesmo corpo gravado sozinho.
    const idiomaDaResposta =
      alteracao.responseLanguage === undefined
        ? undefined
        : idiomaDaRespostaOuRecusa(alteracao.responseLanguage);

    if (alteracao.locale !== undefined) {
      await this.usuarios.updateLocale(userId, alteracao.locale);
    }
    if (idiomaDaResposta !== undefined) {
      await this.usuarios.updateResponseLanguage(userId, idiomaDaResposta);
    }
    return preferenciasDoUsuario(this.resolver, userId);
  }
}
