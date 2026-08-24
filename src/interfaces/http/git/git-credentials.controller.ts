import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RegisterGitCredentialUseCase } from '../../../application/use-cases/git/register-git-credential.use-case';
import { RegisterGitCredentialDto } from './dto/register-git-credential.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { UserCredentialResponseDto } from '../llm/dto/llm.response.dto';

// Sem @RequireRole — credencial é sobre o próprio usuário autenticado,
// mesmo padrão de users/me/credentials (LLM). GET/DELETE/test reaproveitam os
// endpoints já existentes em CredentialsController (mesma tabela, mesmo
// UserCredentialRepository, já alargado pra CredentialProviderName).
//
// O registro segue num caminho próprio porque o CORPO é diferente (`token`,
// e o enum de providers é outro), não mais por causa do teste de conexão:
// desde o ADR 0050 nenhum dos dois cadastros testa nada antes de gravar.
@ApiTags('credentials')
@ApiBearerAuth(BEARER)
@Controller('users/me/git-credentials')
export class GitCredentialsController {
  constructor(
    private readonly registerGitCredential: RegisterGitCredentialUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registers a git token (encrypted, without testing)',
    description:
      'Its own path, not the `users/me/credentials` one, because the body ' +
      'is different (`token`, and the provider enum is `github`/`gitlab`). ' +
      'The token is encrypted and stored without prior verification (ADR ' +
      '0050); to verify it, `POST /users/me/credentials/{provider}/test`. ' +
      'Reading, removal, and testing reuse the `users/me/credentials` routes ' +
      "— it's the same table.",
  })
  @ApiCreatedResponse({ type: UserCredentialResponseDto })
  create(@CurrentUser() user: User, @Body() dto: RegisterGitCredentialDto) {
    return this.registerGitCredential.execute(user.id, dto.provider, dto.token);
  }
}
