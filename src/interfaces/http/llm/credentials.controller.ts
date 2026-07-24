import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { CredentialProviderName } from '@brabo/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { UpsertUserCredentialUseCase } from '../../../application/use-cases/llm/upsert-user-credential.use-case';
import { ListUserCredentialsUseCase } from '../../../application/use-cases/llm/list-user-credentials.use-case';
import { DeleteUserCredentialUseCase } from '../../../application/use-cases/llm/delete-user-credential.use-case';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';

// Sem @RequireRole — credenciais são sobre o próprio usuário autenticado,
// não escopadas a workspace/projeto. Nunca retornar o segredo, nem
// cifrado — só a projeção {id, provider, createdAt, updatedAt}.
@Controller('users/me/credentials')
export class CredentialsController {
  constructor(
    private readonly upsertCredential: UpsertUserCredentialUseCase,
    private readonly listCredentials: ListUserCredentialsUseCase,
    private readonly deleteCredential: DeleteUserCredentialUseCase,
  ) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: UpsertCredentialDto) {
    return this.upsertCredential.execute(user.id, dto.provider, dto.apiKey);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.listCredentials.execute(user.id);
  }

  @Delete(':provider')
  async remove(
    @CurrentUser() user: User,
    @Param('provider') provider: CredentialProviderName,
  ) {
    await this.deleteCredential.execute(user.id, provider);
    return { ok: true };
  }
}
