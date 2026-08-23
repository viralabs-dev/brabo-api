// Ver a nota em update-workspace.dto.ts sobre a origem do `PartialType`.
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

/**
 * O modo de execução e o caminho ficam de FORA (RN-169/RN-421/RN-422,
 * ADR 0072/0104).
 *
 * Onde o comando executa é decisão da CRIAÇÃO, e congelada — como o
 * `workspace_dir_name` (RN-109), que nunca esteve aqui. Trocar o modo de um
 * projeto que já existe não é editar um campo: é mudar a raiz de escopo
 * debaixo de um `permissions.json` que já foi escrito, de worktrees que já
 * existem no disco e de um engine que pode estar com um agente rodando ali
 * dentro — mudança que exige mover conteúdo, não um `UPDATE`. Essa conversão
 * EXISTE (RN-447..450, ADR 0111), mas por uma rota DEDICADA —
 * `PUT :projectId/execution-mode`, `ConvertProjectExecutionModeUseCase`
 * — que orquestra a migração (permissions.json, ciclo de vida do container,
 * checagem de dev agent ativo) em vez de um `PATCH` que só trocaria a
 * coluna. O ADR 0104 (item 4) tinha registrado a intenção de forma
 * incorreta ("sem recriar o projeto" soava como PATCH trivial); a correção
 * mora em `docs/explanation/backlog.md` e no próprio ADR 0111.
 *
 * A exclusão AQUI é EXPLÍCITA porque `PartialType(CreateProjectDto)` herda
 * todo campo novo do DTO de criação por default, e o `ValidationPipe`
 * global tem `whitelist: true`: sem o `OmitType`, os dois campos entrariam
 * na rota de PATCH sem passar pela orquestração da rota dedicada — o
 * `UpdateProjectUseCase` os repassaria direto ao repositório, e um
 * `workspace_path` em `/etc` seria gravado sem que a guarda da conversão
 * tivesse chance de recusar.
 */
export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['executionMode', 'workspacePath'] as const),
) {}
