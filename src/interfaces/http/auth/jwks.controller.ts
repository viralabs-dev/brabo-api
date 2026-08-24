import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './public.decorator';
import { AccessTokenIssuer } from '../../../application/ports/access-token-issuer.port';
import { JwksResponseDto } from './dto/auth.dto';

/**
 * JWKS público (Fase 7a, item 1).
 *
 * É a metade pública do par Ed25519 que assina os access tokens. Precisa ser
 * `@Public()` pela mesma razão que `/metrics`: quem consome não tem token — e
 * exigir um seria pedir credencial para poder validar credencial.
 *
 * Publicar chave PÚBLICA é o propósito do formato, não um vazamento. O teste
 * `o JWKS não vaza a chave privada` trava o componente `d` da JWK, que é o que
 * de fato não pode sair daqui.
 */
@ApiTags('auth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly tokens: AccessTokenIssuer) {}

  @Get('jwks.json')
  @Public()
  @ApiOperation({
    summary: 'Public access token verification keys',
    description:
      'One key in normal operation; two during an AUTH_JWT_SECRET rotation.',
  })
  @ApiOkResponse({ type: JwksResponseDto })
  jwks() {
    return this.tokens.jwks();
  }
}
