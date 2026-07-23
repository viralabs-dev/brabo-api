import { Injectable } from '@nestjs/common';
import { encode } from 'gpt-tokenizer';
import { TokenEstimator } from '../../application/ports/token-estimator.port';

/**
 * Fallback quando o provider não retorna contagem de tokens. Não é
 * exata para todo modelo/provider — por isso o chamador sempre marca
 * `estimated: true` ao usar este caminho.
 */
@Injectable()
export class GptTokenizerEstimator implements TokenEstimator {
  count(text: string): number {
    return encode(text).length;
  }
}
