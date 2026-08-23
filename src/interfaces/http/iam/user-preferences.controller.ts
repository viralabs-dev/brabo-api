import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { GetUserPreferencesUseCase } from '../../../application/use-cases/iam/get-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../../application/use-cases/iam/update-user-preferences.use-case';
import {
  UpdateUserPreferencesDto,
  UserPreferencesResponseDto,
} from './dto/user-preferences.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';

/**
 * Preferências do próprio usuário (fundação de i18n, Onda 6a).
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
  ) {}

  @Get()
  @ApiOperation({
    summary: "Reads the authenticated user's language preference",
  })
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  get(@CurrentUser() user: User) {
    return this.getPreferences.execute(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: "Writes the authenticated user's language preference",
    description:
      "Only `locale` for now — it's the only preference that exists. " +
      'Closed to the `pt-BR`/`en` list; any other value is a 400.',
  })
  @ApiOkResponse({ type: UserPreferencesResponseDto })
  update(@CurrentUser() user: User, @Body() dto: UpdateUserPreferencesDto) {
    return this.updatePreferences.execute(user.id, dto.locale);
  }
}
