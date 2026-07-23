import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SetModelBindingUseCase } from '../../../application/use-cases/llm/set-model-binding.use-case';
import { GetModelBindingUseCase } from '../../../application/use-cases/llm/get-model-binding.use-case';
import { ResolveModelBindingUseCase } from '../../../application/use-cases/llm/resolve-model-binding.use-case';
import { SetModelBindingDto } from './dto/set-model-binding.dto';

@Controller()
export class ModelBindingsController {
  constructor(
    private readonly setBinding: SetModelBindingUseCase,
    private readonly getBinding: GetModelBindingUseCase,
    private readonly resolveBinding: ResolveModelBindingUseCase,
  ) {}

  @Get('workspaces/:workspaceId/model-binding')
  @RequireRole('viewer')
  getWorkspaceBinding(@Param('workspaceId') workspaceId: string) {
    return this.getBinding.execute('workspace', workspaceId);
  }

  @Put('workspaces/:workspaceId/model-binding')
  @RequireRole('maintainer')
  setWorkspaceBinding(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute(
      'workspace',
      workspaceId,
      dto.modelId,
      user.id,
    );
  }

  @Get('projects/:projectId/model-binding')
  @RequireRole('viewer')
  getProjectBinding(@Param('projectId') projectId: string) {
    return this.getBinding.execute('project', projectId);
  }

  @Put('projects/:projectId/model-binding')
  @RequireRole('maintainer')
  setProjectBinding(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('project', projectId, dto.modelId, user.id);
  }

  /** Retorna o binding RESOLVIDO (cascata aplicada) + a origem — não o binding cru de sessão. */
  @Get('projects/:projectId/sessions/:sessionId/model-binding')
  @RequireRole('viewer')
  getSessionBinding(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.resolveBinding.execute({ projectId, sessionId });
  }

  @Put('projects/:projectId/sessions/:sessionId/model-binding')
  @RequireRole('developer')
  setSessionBinding(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('session', sessionId, dto.modelId, user.id);
  }

  /** Binding RESOLVIDO (cascata workspace→projeto→agente, sem sessão). */
  @Get('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('viewer')
  getAgentBinding(
    @Param('projectId') projectId: string,
    @Param('agentSlug') agentSlug: string,
  ) {
    return this.resolveBinding.execute({ projectId, agentId: agentSlug });
  }

  @Put('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('developer')
  setAgentBinding(
    @Param('projectId') _projectId: string,
    @Param('agentSlug') agentSlug: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('agent', agentSlug, dto.modelId, user.id);
  }
}
