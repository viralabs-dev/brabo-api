import { Injectable } from '@nestjs/common';
import {
  TokenVerifier,
  type VerifiedToken,
} from '../../application/ports/token-verifier.port';
import { AccessTokenIssuer } from '../../application/ports/access-token-issuer.port';

/**
 * Adapter do `TokenVerifier` para o emissor próprio (Fase 7a, item 4).
 *
 * É a troca que o docblock do `AuthHttpModule` prometia desde a 7.1: uma
 * linha de `useClass`, e nenhum controller muda.
 *
 * `sub` aqui é o `users.id` — quem assinou o token foi esta mesma api, para
 * aquela linha. `name` é `null` porque o access token não carrega nome: ele
 * existe para autorizar, não para exibir, e o guard busca a linha do usuário
 * de qualquer forma. Menos claim no token é menos coisa para invalidar quando
 * o perfil muda.
 */
@Injectable()
export class FirstPartyTokenVerifier extends TokenVerifier {
  constructor(private readonly tokens: AccessTokenIssuer) {
    super();
  }

  async verify(token: string): Promise<VerifiedToken> {
    const claims = await this.tokens.verificar(token);
    return { sub: claims.userId, email: claims.email, name: null };
  }
}
