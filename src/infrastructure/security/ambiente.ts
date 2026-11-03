import { readFileSync } from 'node:fs';

/** Gravado na imagem pelo Dockerfile de produção (build-arg `BRABO_AMBIENTE`). */
export const ARQUIVO_AMBIENTE_DA_IMAGEM = '/app/AMBIENTE_DA_IMAGEM';

/**
 * O acesso rápido por papel (AT-722) só existe com `BRABO_AMBIENTE=local` E com
 * a imagem sem marca ou marcada `local`. Lista de PERMITIDOS de um valor:
 * variável ausente, vazia ou qualquer outro valor = não existe. `NODE_ENV` não
 * entra: a instalação local roda com `NODE_ENV=production`. O arquivo vence a
 * variável, porque `environment:` do compose sobrescreve `ENV`, não arquivo.
 */
export function acessoRapidoLigado(
  env: NodeJS.ProcessEnv = process.env,
  lerArquivo: (caminho: string) => string = (c) => readFileSync(c, 'utf8'),
): boolean {
  if (env.BRABO_AMBIENTE !== 'local') return false;
  let marca: string;
  try {
    marca = lerArquivo(ARQUIVO_AMBIENTE_DA_IMAGEM);
  } catch {
    return true; // sem imagem (pnpm dev / ts-node): só a variável decide
  }
  return marca.trim() === 'local';
}
