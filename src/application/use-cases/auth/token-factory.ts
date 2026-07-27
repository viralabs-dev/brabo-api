import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashDeToken } from '../../../infrastructure/security/auth-key-material';

/**
 * Geração dos tokens opacos (refresh e tokens de conta).
 *
 * ## `randomBytes`, e nada mais
 *
 * 32 bytes do CSPRNG, em base64url. Merece constar por escrito porque as
 * alternativas estão à mão neste repositório e todas são piores:
 *
 * - `ulid()` já é dependência e é usado em `session_events`. Um ULID tem 48
 *   bits de timestamp PREVISÍVEL e só 80 bits aleatórios — um token de sessão
 *   feito com ele carrega o instante da emissão em claro;
 * - `randomUUID()` tem 122 bits e ainda fixa bits de versão e variante;
 * - `Math.random()` não é criptográfico, e o dia em que alguém "simplificar"
 *   isso o sistema inteiro cai sem barulho nenhum.
 *
 * 256 bits é o que torna o SHA-256 no banco suficiente: não há dicionário
 * contra essa entropia, então argon2 aqui compraria zero bit por um custo
 * enorme. Ver `hashDeToken`.
 */
@Injectable()
export class TokenFactory {
  /** Devolve o token bruto (só ele viaja) e o hash (só ele é guardado). */
  gerar(): { bruto: string; hash: string } {
    const bruto = randomBytes(32).toString('base64url');
    return { bruto, hash: hashDeToken(bruto) };
  }

  hashDe(bruto: string): string {
    return hashDeToken(bruto);
  }
}
