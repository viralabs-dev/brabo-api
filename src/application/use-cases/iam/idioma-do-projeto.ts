import { BadRequestException } from '@nestjs/common';
import { normalizarIdiomaBcp47 } from '../../../domain/iam/idioma-de-resposta';

/**
 * O idioma do PROJETO canonicalizado, ou 400 com a regra escrita (RN-619).
 *
 * A MESMA régua do idioma das respostas (`normalizarIdiomaBcp47`, RN-618),
 * com uma diferença: o projeto não tem "automático". Automático é resolver
 * pelas mensagens de uma PESSOA, e o idioma do projeto existe justamente para
 * o que não tem pessoa nenhuma escrevendo — então `automatico` aqui é código
 * inválido como qualquer outro.
 */
export function idiomaDoProjetoOuRecusa(valor: string): string {
  const canonico = normalizarIdiomaBcp47(valor);
  if (canonico === null) {
    throw new BadRequestException(
      `"${valor}" não é um código de idioma BCP-47 reconhecido (ex.: pt-BR, en, es, fr-CA). O projeto sempre tem um idioma concreto — não existe "automático" para ele.`,
    );
  }
  return canonico;
}
