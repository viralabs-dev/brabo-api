import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
// mesmo padrão de users/me/credentials (LLM). GET/DELETE reaproveitam os
// endpoints já existentes em CredentialsController (mesma tabela, mesmo
// UserCredentialRepository, já alargado pra CredentialProviderName) —
// só o registro precisa de um caminho próprio, por causa do teste de
// conexão obrigatório antes de persistir.
@ApiTags('credenciais')
@ApiBearerAuth(BEARER)
@Controller('users/me/git-credentials')
export class GitCredentialsController {
  constructor(
    private readonly registerGitCredential: RegisterGitCredentialUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registra um token de git depois de TESTAR a conexão',
    description:
      'Caminho próprio, e não o de `users/me/credentials`, por causa do teste: o ' +
      'token é validado contra o provider ANTES de ser persistido, para não guardar ' +
      'uma credencial que só falharia no primeiro push. A leitura e a remoção ' +
      'reaproveitam as rotas de `users/me/credentials` — é a mesma tabela.',
  })
  @ApiCreatedResponse({ type: UserCredentialResponseDto })
  @ApiBadRequestResponse({ description: 'O provider recusou o token.' })
  create(@CurrentUser() user: User, @Body() dto: RegisterGitCredentialDto) {
    return this.registerGitCredential.execute(user.id, dto.provider, dto.token);
  }
}
