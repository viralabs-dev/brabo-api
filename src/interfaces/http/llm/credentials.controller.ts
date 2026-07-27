import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { CredentialProviderName } from '@brabo/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { UpsertUserCredentialUseCase } from '../../../application/use-cases/llm/upsert-user-credential.use-case';
import { ListUserCredentialsUseCase } from '../../../application/use-cases/llm/list-user-credentials.use-case';
import { DeleteUserCredentialUseCase } from '../../../application/use-cases/llm/delete-user-credential.use-case';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import { UserCredentialResponseDto } from './dto/llm.response.dto';

// Sem @RequireRole — credenciais são sobre o próprio usuário autenticado,
// não escopadas a workspace/projeto. Nunca retornar o segredo, nem
// cifrado — só a projeção {id, provider, createdAt, updatedAt}.
@ApiTags('credenciais')
@ApiBearerAuth(BEARER)
@Controller('users/me/credentials')
export class CredentialsController {
  constructor(
    private readonly upsertCredential: UpsertUserCredentialUseCase,
    private readonly listCredentials: ListUserCredentialsUseCase,
    private readonly deleteCredential: DeleteUserCredentialUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registra ou substitui a chave de API de um provider',
    description:
      'Upsert por (usuário, provider). A chave é cifrada por envelope encryption ' +
      'antes de tocar o banco e a resposta traz só a PROJEÇÃO — nunca o segredo, ' +
      'nem cifrado.',
  })
  @ApiCreatedResponse({ type: UserCredentialResponseDto })
  create(@CurrentUser() user: User, @Body() dto: UpsertCredentialDto) {
    return this.upsertCredential.execute(user.id, dto.provider, dto.apiKey);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista as credenciais do próprio usuário',
    description:
      'Sem papel exigido: credencial é sobre quem chamou, não sobre workspace ou ' +
      'projeto. Cobre chaves de LLM e tokens de git na mesma listagem.',
  })
  @ApiOkResponse({ type: [UserCredentialResponseDto] })
  list(@CurrentUser() user: User) {
    return this.listCredentials.execute(user.id);
  }

  @Delete(':provider')
  @ApiParam({ name: 'provider', example: 'anthropic' })
  @ApiOperation({
    summary: 'Remove a credencial de um provider',
    description:
      'Idempotente: apagar o que não existe também responde `{ ok: true }`.',
  })
  @ApiOkResponse({ type: OkResponseDto })
  async remove(
    @CurrentUser() user: User,
    @Param('provider') provider: CredentialProviderName,
  ) {
    await this.deleteCredential.execute(user.id, provider);
    return { ok: true };
  }
}
