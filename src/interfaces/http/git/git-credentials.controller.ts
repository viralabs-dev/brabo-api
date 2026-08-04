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
@ApiTags('credenciais')
@ApiBearerAuth(BEARER)
@Controller('users/me/git-credentials')
export class GitCredentialsController {
  constructor(
    private readonly registerGitCredential: RegisterGitCredentialUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registra um token de git (cifrado, sem testar)',
    description:
      'Caminho próprio, e não o de `users/me/credentials`, porque o corpo é outro ' +
      '(`token`, e o enum de providers é `github`/`gitlab`). O token é cifrado e ' +
      'gravado sem verificação prévia (ADR 0050); para verificá-lo, ' +
      '`POST /users/me/credentials/{provider}/test`. Leitura, remoção e teste ' +
      'reaproveitam as rotas de `users/me/credentials` — é a mesma tabela.',
  })
  @ApiCreatedResponse({ type: UserCredentialResponseDto })
  create(@CurrentUser() user: User, @Body() dto: RegisterGitCredentialDto) {
    return this.registerGitCredential.execute(user.id, dto.provider, dto.token);
  }
}
