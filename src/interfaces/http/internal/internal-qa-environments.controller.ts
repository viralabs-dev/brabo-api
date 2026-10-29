import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { InstanciaDeQaUseCase } from '../../../application/use-cases/containers/instancia-de-qa.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import {
  QaEnvironmentResponseDto,
  SweepQaEnvironmentsInternalDto,
  SweepQaEnvironmentsResponseDto,
} from './dto/qa-environment-internal.dto';

/**
 * A instância de QA efêmera que o ENGINE pede (AT-612, ADR 0229, RN-935..938).
 * A api é quem chama o broker e quem grava `project_qa_environments`.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalQaEnvironmentsController {
  constructor(private readonly qa: InstanciaDeQaUseCase) {}

  @Post('projects/:projectId/qa-environments/:taskId/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Brings up the ephemeral QA instance of a task (RN-935)',
    description:
      'Records the row, then asks the broker. `sucesso: false` is the NORMAL ' +
      'shape of a refused broker. At most ONE active instance per project: ' +
      'another task active -> 409 `instancia_de_qa_ocupada`. `runner` projects -> 409 `qa_nao_suporta_runner`.',
  })
  @ApiOkResponse({ type: QaEnvironmentResponseDto })
  @ApiNotFoundResponse({
    description: 'Project or task (of that project) not found.',
  })
  @ApiConflictResponse({
    description: 'Busy instance, runner project or ambiguous task key.',
  })
  start(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.qa.start(projectId, taskId);
  }

  @Post('projects/:projectId/qa-environments/:taskId/remove')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Removes the QA instance of a task (RN-936)',
    description:
      'Automatic, no proposal: it only reaches what carries the QA label (the broker guarantees it). Idempotent.',
  })
  @ApiOkResponse({ type: QaEnvironmentResponseDto })
  @ApiNotFoundResponse({ description: 'Project or task not found.' })
  remove(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.qa.remove(projectId, taskId);
  }

  @Post('qa-environments/sweep')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Removes QA instances whose gate is no longer in flight (RN-937)',
    description:
      'The engine sends the task ids it still has in flight; every other active or failed instance is removed. Shared services and the QA network have no broker operation yet (declared gap).',
  })
  @ApiOkResponse({ type: SweepQaEnvironmentsResponseDto })
  sweep(@Body() dto: SweepQaEnvironmentsInternalDto) {
    return this.qa.limparOrfas(dto.taskIdsEmVoo, dto.projectId);
  }
}
