// Ver a nota em update-workspace.dto.ts sobre a origem do `PartialType`.
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

/**
 * O modo de workspace e o caminho ficam de FORA (RN-169/RN-170, ADR 0072).
 *
 * Onde o código mora é decisão da CRIAÇÃO, e congelada — como o
 * `workspace_dir_name` (RN-109), que nunca esteve aqui. Trocar o modo de um
 * projeto que já existe não é editar um campo: é mudar a raiz de escopo
 * debaixo de um `permissions.json` que já foi escrito, de worktrees que já
 * existem no disco e de um engine que pode estar com um agente rodando ali
 * dentro — mudança que exige mover conteúdo, não um `UPDATE`.
 *
 * A exclusão é EXPLÍCITA porque `PartialType(CreateProjectDto)` herda todo
 * campo novo do DTO de criação por default, e o `ValidationPipe` global tem
 * `whitelist: true`: sem o `OmitType`, os dois campos entrariam na rota de
 * PATCH sem passar por validação nenhuma — o `UpdateProjectUseCase` os
 * repassaria direto ao repositório, e um `workspace_path` em `/etc` seria
 * gravado sem que a guarda da criação tivesse chance de recusar.
 */
export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['workspaceMode', 'workspacePath'] as const),
) {}
