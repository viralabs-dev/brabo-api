// Anexos do chat (AT-715, ADR 0246, RN-986): tipo pelos BYTES e tetos. Puro.

export const TETO_DA_IMAGEM = 5 * 1024 * 1024;
export const TETO_DO_TEXTO = 512 * 1024;
export const MAX_ANEXOS_POR_MENSAGEM = 4;

export interface ReferenciaDeAnexo {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
}

export class AnexoTipoNaoAceitoError extends Error {}
export class AnexoGrandeDemaisError extends Error {}

function imagemPelosBytes(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const cab = b.subarray(0, 6).toString('latin1');
  if (cab === 'GIF87a' || cab === 'GIF89a') return 'image/gif';
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Devolve o MIME conferido pelos bytes ou lança 415/413 (traduzidos no caso de uso). */
export function classificarAnexo(b: Buffer): string {
  if (b.length === 0) throw new AnexoTipoNaoAceitoError('Anexo vazio.');
  const imagem = imagemPelosBytes(b);
  if (imagem) {
    if (b.length > TETO_DA_IMAGEM)
      throw new AnexoGrandeDemaisError(
        `Imagem acima de ${TETO_DA_IMAGEM} bytes.`,
      );
    return imagem;
  }
  // Texto/código: UTF-8 válido e sem NUL (binário disfarçado cai aqui).
  let utf8 = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    utf8 = false;
  }
  if (!utf8 || b.includes(0))
    throw new AnexoTipoNaoAceitoError(
      'Tipo não aceito: só texto/código e png, jpeg, webp ou gif.',
    );
  if (b.length > TETO_DO_TEXTO)
    throw new AnexoGrandeDemaisError(`Texto acima de ${TETO_DO_TEXTO} bytes.`);
  return 'text/plain';
}
