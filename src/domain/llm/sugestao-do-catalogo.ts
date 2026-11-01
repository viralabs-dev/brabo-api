import type { ModelBilling } from './model.entity';
import {
  precoDoFabricante,
  type PrecoDoFabricante,
} from './precos-do-fabricante';

export interface SugestaoDoCatalogo {
  cobranca: ModelBilling | null;
  preco: Omit<PrecoDoFabricante, 'modelo' | 'ids'> | null;
}

/**
 * Sugestão de faixa e preço (AT-640, RN-965). Pura, derivada na LEITURA, nunca
 * gravada. Faixa só para `9router`, pelo alias do id (amarrada à 0.5.112, como
 * a RN-958); preço por igualdade exata na tabela do fabricante. `openrouter`
 * fica sem sugestão: o preço dele vem do sync e o custo real do `usage.cost`.
 */
export function sugestaoDoModelo(
  provider: string,
  name: string,
): SugestaoDoCatalogo | null {
  if (provider === 'openrouter') return null;

  let cobranca: ModelBilling | null = null;
  let id = name;
  if (provider === '9router') {
    const barra = name.indexOf('/');
    const alias = barra < 0 ? '' : name.slice(0, barra);
    id = barra < 0 ? name : name.slice(barra + 1);
    cobranca =
      alias === 'cc' || alias === 'cx'
        ? 'subscription'
        : alias === 'ollama' || /[:/-]free$/.test(name)
          ? 'free'
          : 'api';
  }

  const linha = precoDoFabricante(id);
  if (!cobranca && !linha) return null;
  const preco = linha
    ? {
        fabricante: linha.fabricante,
        entradaMicros: linha.entradaMicros,
        saidaMicros: linha.saidaMicros,
        fonte: linha.fonte,
        conferidoEm: linha.conferidoEm,
        ...(linha.observacao ? { observacao: linha.observacao } : {}),
      }
    : null;
  return { cobranca, preco };
}
