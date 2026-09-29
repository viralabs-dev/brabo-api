import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { GetUserPreferencesUseCase } from '../../../application/use-cases/iam/get-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../../application/use-cases/iam/update-user-preferences.use-case';
import { DetectarIdiomaDoAutorUseCase } from '../../../application/use-cases/iam/detectar-idioma-do-autor.use-case';
import {
  AnswerDetectedLanguageDto,
  UpdateUserPreferencesDto,
  UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';

/**
 * Preferências do próprio usuário (fundação de i18n, Onda 6a) — desde a
 * RN-618 também o idioma em que os AGENTES respondem, ao lado do da interface.
 *
 * Sem `@RequireRole` — mesmo padrão de `users/me/credentials`: preferência é
 * sobre quem chamou, nunca escopada a workspace/projeto.
 *
 * A leitura AQUI é redundante com o `locale` que já vem no corpo de
 * `/auth/login` e `/auth/refresh` (`EmitirSessaoUseCase`) — de propósito: a
 * web usa a redundância só para reafirmar o valor sem esperar o próximo
 * refresh (ver `GetUserPreferencesUseCase`), nunca como a fonte primária.
 */
@ApiTags('users')
@ApiBearerAuth(BEARER)
@Controller('users/me/preferences')
export class UserPreferencesController {
  constructor(
    private readonly getPreferences: GetUserPreferencesUseCase,
    private readonly updatePreferences: UpdateUserPreferencesUseCase,
    private readonly deteccao: DetectarIdiomaDoAutorUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Reads the authenticated user's interface language and agent response language",
  })
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  get(@CurrentUser() user: User) {
    return this.getPreferences.execute(user.id);
  }

  @Patch()
  @ApiOperation({
    summary:
      "Writes the authenticated user's interface language and/or agent response language",
    description:
      'Both fields are optional and independent — sending one never touches ' +
      'the other, and a body with neither is a 400. `locale` (the ' +
      'interface) stays closed to the `pt-BR`/`en` list. `responseLanguage` ' +
      '(RN-618) is `automatico` or any recognized BCP-47 code, stored ' +
      'canonical; an unrecognized code is a 400 and nothing in the body is ' +
      'written.',
  })
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  update(@CurrentUser() user: User, @Body() dto: UpdateUserPreferencesDto) {
    return this.updatePreferences.execute(user.id, {
      locale: dto.locale,
      responseLanguage: dto.responseLanguage,
    });
  }

  @Post('detected-language')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answers the detected-language question',
    description:
      'The only way a detected language becomes a preference (RN-624): ' +
      'detection alone never changes anything. `confirm` writes ' +
      '`detectedLanguage` + `detectedLanguageConfirmedAt`; `decline` records ' +
      'the refusal so the same language is not asked again. Returns the ' +
      'preferences after the answer.',
  })
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  @ApiBadRequestResponse({
    description: 'A code that is not a recognized BCP-47 language.',
  })
  @ApiConflictResponse({
    description:
      '`deteccao_mudou`: on `confirm`, your recent messages no longer point ' +
      'to that language — nothing was written.',
  })
  answerDetected(
    @CurrentUser() user: User,
    @Body() dto: AnswerDetectedLanguageDto,
  ) {
    return this.deteccao.responder(user.id, dto.language, dto.answer);
  }
}
