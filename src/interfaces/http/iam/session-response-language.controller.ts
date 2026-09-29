import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from './require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { IdiomaDaRespostaNaSessaoUseCase } from '../../../application/use-cases/iam/idioma-da-resposta-na-sessao.use-case';
import { DetectarIdiomaDoAutorUseCase } from '../../../application/use-cases/iam/detectar-idioma-do-autor.use-case';
import type { IdiomaDaRespostaDaPessoa } from '../../../application/use-cases/iam/resolver-idioma-da-resposta.use-case';
import {
  SessionResponseLanguageResponseDto,
  SetSessionResponseLanguageDto,
} from './dto/session-response-language.dto';

function paraOFio(
  r: IdiomaDaRespostaDaPessoa,
  detectionQuestion: string | null,
): SessionResponseLanguageResponseDto {
  return {
    language: r.idioma,
    origin: r.origem,
    sessionOverride: r.fontes.sessao,
    account: r.fontes.conta,
    detected: r.fontes.detectado,
    interfaceLocale: r.fontes.interface,
    detectionQuestion,
  };
}

/**
 * O idioma das respostas de QUEM CHAMA numa sessão (RN-618).
 *
 * Mora no módulo de IAM, e não no de sessões, porque é preferência da PESSOA
 * que por acaso tem escopo de sessão — o `userId` vem do token, e não há
 * rota para ler nem mexer no idioma de outro participante.
 *
 * Os papéis são os mínimos do que o valor AFETA: ler é `viewer` (quem vê a
 * sessão vê em que idioma lhe responderiam); fixar é `developer`, o mesmo
 * papel de mandar mensagem a um agente — o override só muda as respostas às
 * mensagens da própria pessoa, e quem não pode mandar mensagem não tem o que
 * ele mudar.
 */
@ApiTags('sessions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role in the project.' })
@ApiNotFoundResponse({ description: 'Project or session does not exist.' })
@Controller('projects/:projectId/sessions/:sessionId/response-language')
export class SessionResponseLanguageController {
  constructor(
    private readonly idiomaNaSessao: IdiomaDaRespostaNaSessaoUseCase,
    private readonly deteccao: DetectarIdiomaDoAutorUseCase,
  ) {}

  /**
   * A resposta com a pergunta da detecção (RN-624) — que é melhor esforço e
   * nunca lança: a leitura do idioma não cai por causa dela.
   */
  private async comPergunta(
    userId: string,
    r: IdiomaDaRespostaDaPessoa,
  ): Promise<SessionResponseLanguageResponseDto> {
    const pergunta = await this.deteccao.pergunta(userId, {
      idioma: r.idioma,
      origem: r.origem,
    });
    return paraOFio(r, pergunta);
  }

  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'The language agents answer YOU in, in this session',
    description:
      'Resolved for the CALLER, never for the session: session override > ' +
      'Account choice > detected-and-confirmed > interface language ' +
      '(RN-618). Returns the winner, its origin and every link of the chain — ' +
      'and, when your recent messages point to another language and the ' +
      'screen should ask about it, `detectionQuestion` (RN-624).',
  })
  @ApiOkResponse({ type: SessionResponseLanguageResponseDto })
  async get(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
  ): Promise<SessionResponseLanguageResponseDto> {
    return this.comPergunta(
      user.id,
      await this.idiomaNaSessao.ler(projectId, sessionId, user.id),
    );
  }

  @Put()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Fixes (or releases) YOUR response language in this session',
    description:
      'Only for the caller, only in this session (RN-618) — the other ' +
      'participants and your Account choice are untouched. `null` goes back ' +
      'to inheriting from the Account.',
  })
  @ApiOkResponse({ type: SessionResponseLanguageResponseDto })
  @ApiBadRequestResponse({
    description:
      'Body without `language`, or a code that is not a recognized BCP-47 ' +
      'language.',
  })
  async set(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: SetSessionResponseLanguageDto,
  ): Promise<SessionResponseLanguageResponseDto> {
    return this.comPergunta(
      user.id,
      await this.idiomaNaSessao.definir(
        projectId,
        sessionId,
        user.id,
        dto.language,
      ),
    );
  }
}
