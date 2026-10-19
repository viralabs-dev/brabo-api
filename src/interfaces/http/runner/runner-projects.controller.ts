import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { ListRunnerProjectsUseCase } from '../../../application/use-cases/runner/list-runner-projects.use-case';
import { RunnerProjectResponseDto } from './dto/runner-project.response.dto';

/**
 * `GET /runner/projects` — como o agente local de MÁQUINA descobre os
 * projetos que atende (RN-543, ADR 0154 ponto 3). Ele consulta no start e
 * abre uma conexão por projeto listado; o tópico `terminal:<projectId>`, o
 * socket id e o ticket continuam descrevendo uma CONEXÃO, e N conexões os
 * satisfazem byte a byte — nada no engine muda por causa desta rota.
 *
 * ## A primeira rota `@RequirePatAuth()` SEM projeto no caminho
 *
 * É de propósito, e é o que a rota existe para resolver: quem chama ainda não
 * sabe quais projetos há. Consequências, as duas travadas por teste:
 *
 * 1. Só uma credencial de MÁQUINA entra (`runner_device_keys.project_id`
 *    NULL). Uma credencial de PROJETO — PAT ou chave do ADR 0118 — descreve
 *    um projeto só e não tem o que descobrir; `PatAuthGuard` a recusa com
 *    403 e mensagem PRÓPRIA, nunca com a de "projeto errado", que mentiria
 *    sobre o motivo.
 * 2. Não há `@RequireRole`, porque não há projeto contra o que resolvê-lo.
 *    O mínimo (`developer`, o MESMO de `runner-ticket`) é aplicado por
 *    LINHA dentro de `ListRunnerProjectsUseCase`, com a régua única do
 *    produto. Nada afrouxa: o que sai daqui é exatamente o conjunto de
 *    projetos para os quais `runner-ticket` já autorizaria este usuário.
 *
 * Por isso `route-surface.spec.ts` classifica esta rota como `jwt` — o
 * classificador automático lê `@RequireRole` e não enxerga mecanismo — e
 * `docs/security-surface.md` corrige a leitura em prosa, exatamente como já
 * faz para `runner-ticket`. Ela **não** aceita JWT de sessão: `JwtAuthGuard`
 * se abstém em rota `@RequirePatAuth()`, e a chave pública que `PatAuthGuard`
 * verifica vem de `runner_device_keys`, nunca do emissor de sessão.
 */
@ApiTags('projects')
@ApiBearerAuth(BEARER)
@Controller('runner')
export class RunnerProjectsController {
  constructor(private readonly listarProjetos: ListRunnerProjectsUseCase) {}

  @Get('projects')
  @RequirePatAuth()
  @UseGuards(PatAuthGuard)
  @ApiOperation({
    summary: 'Lists the projects in "runner" mode that this local agent serves',
    description:
      'Authenticated by a MACHINE device key (ADR 0154) — NEVER by a ' +
      'session JWT, and never by a credential bound to a project, which ' +
      'answers 403. Returns the projects in `execution_mode: "runner"` in ' +
      'which the key owner reaches at least `developer` (the same minimum ' +
      'as `POST .../runner-ticket`), with the folder name and verification ' +
      'state of each. The agent asks instead of scanning the disk: the ' +
      'machine base belongs to the user and may hold folders that are not projects.',
  })
  @ApiOkResponse({ type: [RunnerProjectResponseDto] })
  @ApiForbiddenResponse({
    description:
      'The presented credential is bound to a project — this route requires ' +
      'a machine device key.',
  })
  async listRunnerProjects(
    @CurrentUser() user: User,
  ): Promise<RunnerProjectResponseDto[]> {
    const projetos = await this.listarProjetos.execute(user.id);
    return projetos.map((projeto) => ({
      projectId: projeto.projectId,
      name: projeto.name,
      workspaceDirName: projeto.workspaceDirName,
      workspaceVerifiedAt: projeto.workspaceVerifiedAt?.toISOString() ?? null,
    }));
  }
}
