import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequirePatAuth } from '../auth/pat-route.decorator';
import { PatAuthGuard } from '../auth/pat-auth.guard';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ImportRunnerLlmCredentialUseCase } from '../../../application/use-cases/llm/import-runner-llm-credential.use-case';
import {
  ImportLlmCredentialDto,
  ImportLlmCredentialResponseDto,
} from './dto/import-llm-credential.dto';

/**
 * `POST /runner/llm-credentials` — o `brabo-runner credentials import` grava
 * aqui a chave de API que o USUÁRIO escolheu importar (AT-611, ADR 0230,
 * RN-927). Só credencial de dispositivo de MÁQUINA entra: a rota não tem
 * `:projectId`, então o `PatAuthGuard` recusa com 403 toda credencial amarrada
 * a projeto — e todo PAT é de projeto (`personal_access_tokens.project_id`
 * NOT NULL), logo PAT na prática não chama esta rota. É a primeira rota em
 * que credencial de máquina escreve segredo de USUÁRIO.
 */
@ApiTags('credentials')
@ApiBearerAuth(BEARER)
@Controller('runner')
export class RunnerLlmCredentialsController {
  constructor(private readonly importar: ImportRunnerLlmCredentialUseCase) {}

  @Post('llm-credentials')
  @HttpCode(200)
  @RequirePatAuth()
  @UseGuards(PatAuthGuard)
  @ApiOperation({
    summary: 'Stores an LLM API key imported by the local runner',
    description:
      'Authenticated by a MACHINE device key (never a session JWT, never a ' +
      'project-bound credential). Same envelope encryption as ' +
      '`POST /users/me/credentials`. 409 `credencial_existente` when the user ' +
      'already has this provider and `substituir` is not `true`. The key is ' +
      'never logged nor returned.',
  })
  @ApiOkResponse({ type: ImportLlmCredentialResponseDto })
  @ApiConflictResponse({ description: 'Code `credencial_existente`.' })
  @ApiForbiddenResponse({ description: 'Credential bound to a project.' })
  execute(
    @CurrentUser() user: User,
    @Body() dto: ImportLlmCredentialDto,
  ): Promise<ImportLlmCredentialResponseDto> {
    return this.importar.execute(
      user.id,
      dto.provider,
      dto.apiKey,
      dto.origem,
      dto.substituir === true,
    );
  }
}
