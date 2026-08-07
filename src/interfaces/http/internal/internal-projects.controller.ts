import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { GetProjectGitRemoteUseCase } from '../../../application/use-cases/git/get-project-git-remote.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { ProjectGitRemoteResponseDto } from './dto/project-git-remote.response.dto';

/**
 * O que o engine precisa da api para trabalhar no repositório de um projeto
 * ([ADR 0056](../../../../../docs/adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
 *
 * A divisão é a mesma do sync de catálogo: quem trabalha no sistema de
 * arquivos é o engine, quem tem as credenciais é a api. Replicar a chave
 * mestra no engine pouparia uma chamada HTTP e dobraria o raio de explosão do
 * segredo mais sensível do produto.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token ausente ou diferente do compartilhado.',
})
@Controller('internal/projects')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalProjectsController {
  constructor(private readonly getGitRemote: GetProjectGitRemoteUseCase) {}

  @Get(':projectId/git-remote')
  @ApiOperation({
    summary: 'O remoto de trabalho do projeto, para buscar e empurrar',
    description:
      'Devolve a origem limpa (sem credencial embutida) e, para provider ' +
      'remoto, o token do OWNER do workspace (RN-058) decifrado na hora. ' +
      'Quem consome injeta o token por invocação e NUNCA o escreve em ' +
      'arquivo — o `.git/config` fica dentro da pasta onde a RN-075 dá ' +
      'leitura auto-aprovada ao dev agent.',
  })
  @ApiOkResponse({ type: ProjectGitRemoteResponseDto })
  @ApiNotFoundResponse({
    description:
      'Projeto sem repositório provisionado, ou owner do workspace sem ' +
      'credencial cadastrada para o provider do repositório.',
  })
  gitRemote(@Param('projectId') projectId: string) {
    return this.getGitRemote.execute(projectId);
  }
}
