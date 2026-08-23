import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
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
import { TestStoredCredentialUseCase } from '../../../application/use-cases/credentials/test-stored-credential.use-case';
import { UpsertCredentialDto } from './dto/upsert-credential.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import {
  CredentialTestResultResponseDto,
  UserCredentialResponseDto,
} from './dto/llm.response.dto';

// Sem @RequireRole — credenciais são sobre o próprio usuário autenticado,
// não escopadas a workspace/projeto. Nunca retornar o segredo, nem
// cifrado — só a projeção {id, provider, createdAt, updatedAt}.
@ApiTags('credentials')
@ApiBearerAuth(BEARER)
@Controller('users/me/credentials')
export class CredentialsController {
  constructor(
    private readonly upsertCredential: UpsertUserCredentialUseCase,
    private readonly listCredentials: ListUserCredentialsUseCase,
    private readonly deleteCredential: DeleteUserCredentialUseCase,
    private readonly testStoredCredential: TestStoredCredentialUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Registers or replaces a provider's API key",
    description:
      'Upsert by (user, provider). The key is encrypted via envelope encryption ' +
      'before touching the database, and the response carries only the ' +
      'PROJECTION — never the secret, not even encrypted.',
  })
  @ApiCreatedResponse({ type: UserCredentialResponseDto })
  create(@CurrentUser() user: User, @Body() dto: UpsertCredentialDto) {
    return this.upsertCredential.execute(user.id, dto.provider, dto.apiKey);
  }

  @Get()
  @ApiOperation({
    summary: "Lists the current user's own credentials",
    description:
      'No role required: a credential is about whoever called, not about a ' +
      'workspace or project. Covers LLM keys and git tokens in the same listing.',
  })
  @ApiOkResponse({ type: [UserCredentialResponseDto] })
  list(@CurrentUser() user: User) {
    return this.listCredentials.execute(user.id);
  }

  @Post(':provider/test')
  @HttpCode(200)
  @ApiParam({ name: 'provider', example: 'openrouter' })
  @ApiOperation({
    summary: 'Checks the ALREADY stored credential against the provider',
    description:
      'The check is an explicit action, separate from registration (ADR 0050): ' +
      'the api decrypts the secret, calls the provider, and returns ONLY the ' +
      'verdict — the key never comes back, not even in part. Responds 200 for ' +
      'all three outcomes, because the request was processed; `refused` is an ' +
      'outcome, not a protocol error. 404 when there is no credential for ' +
      '(user, provider) — then there is nothing to test.',
  })
  @ApiOkResponse({ type: CredentialTestResultResponseDto })
  @ApiNotFoundResponse({ description: 'No credential for this provider.' })
  test(
    @CurrentUser() user: User,
    @Param('provider') provider: CredentialProviderName,
  ) {
    return this.testStoredCredential.execute(user.id, provider);
  }

  @Delete(':provider')
  @ApiParam({ name: 'provider', example: 'anthropic' })
  @ApiOperation({
    summary: "Removes a provider's credential",
    description:
      'Idempotent: deleting what does not exist also responds `{ ok: true }`.',
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
