import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RegisterGitCredentialUseCase } from '../../../application/use-cases/git/register-git-credential.use-case';
import { RegisterGitCredentialDto } from './dto/register-git-credential.dto';

// Sem @RequireRole — credencial é sobre o próprio usuário autenticado,
// mesmo padrão de users/me/credentials (LLM). GET/DELETE reaproveitam os
// endpoints já existentes em CredentialsController (mesma tabela, mesmo
// UserCredentialRepository, já alargado pra CredentialProviderName) —
// só o registro precisa de um caminho próprio, por causa do teste de
// conexão obrigatório antes de persistir.
@Controller('users/me/git-credentials')
export class GitCredentialsController {
  constructor(
    private readonly registerGitCredential: RegisterGitCredentialUseCase,
  ) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: RegisterGitCredentialDto) {
    return this.registerGitCredential.execute(user.id, dto.provider, dto.token);
  }
}
