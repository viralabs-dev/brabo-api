import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import {
  PROJECT_WORKSPACE_MODES,
  STORY_PROMOTION_MODES,
  type ProjectWorkspaceMode,
  type StoryPromotionMode,
} from '../../../../domain/iam/project.entity';

export class CreateProjectDto {
  @ApiProperty({ example: 'Checkout', minLength: 2 })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    example: 'checkout',
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    description: 'kebab-case. Único dentro do workspace.',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug deve ser kebab-case (ex.: meu-projeto)',
  })
  slug!: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Circuit breaker (Fase 12b — RN-047): quantas tasks consecutivas ' +
      'terminando blocked param o dev agent do módulo em idle_tripped. ' +
      'Omitido usa o default do domínio (DEFAULT_MAX_CONSECUTIVE_BLOCKED). ' +
      'Vale a partir da PRÓXIMA ativação da execução — não afeta agentes já rodando.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxConsecutiveBlocked?: number;

  @ApiPropertyOptional({
    enum: STORY_PROMOTION_MODES,
    example: 'manual',
    description:
      'Quem promove uma story de `draft` para `ready` (Fase 12c — RN-048). ' +
      '`manual` (default de projeto novo): o PO propõe e VOCÊ decide, na aba ' +
      'Backlog. `auto`: a story completa já nasce `ready`, sem passo humano — ' +
      'era o comportamento até a 12c, e projetos criados antes dela ficaram ' +
      'nele. As validações de domínio (DoD/DoR/RF/regra/módulos) são as MESMAS ' +
      'nos dois modos; o modo muda só quem dispara.',
  })
  @IsOptional()
  @IsIn(STORY_PROMOTION_MODES)
  storyPromotion?: StoryPromotionMode;

  @ApiPropertyOptional({
    enum: PROJECT_WORKSPACE_MODES,
    example: 'container',
    description:
      'ONDE o código deste projeto mora (RN-169 — ADR 0072). `container` ' +
      '(default): a pasta gerenciada pelo produto dentro de ' +
      'PROJECT_WORKSPACES_ROOT, que é o comportamento de sempre. `local`: uma ' +
      'pasta SUA, informada em `workspacePath`, que precisa estar montada ' +
      'dentro dos containers da api e do engine — a criação RECUSA (400) o ' +
      'caminho que não estiver, com a instrução de como montar (RN-170).',
  })
  @IsOptional()
  @IsIn(PROJECT_WORKSPACE_MODES)
  workspaceMode?: ProjectWorkspaceMode;

  @ApiPropertyOptional({
    example: '/home/voce/projetos/loja',
    description:
      'Caminho ABSOLUTO da pasta, obrigatório quando `workspaceMode` é ' +
      '`local` e recusado quando é `container`. Validado na criação: precisa ' +
      'existir e ser gravável de dentro do container, e não pode ser a raiz ' +
      'do sistema, pasta de sistema, nem se sobrepor ao checkout do Brabo ' +
      '(RN-170).',
  })
  @IsOptional()
  @IsString()
  workspacePath?: string;
}
