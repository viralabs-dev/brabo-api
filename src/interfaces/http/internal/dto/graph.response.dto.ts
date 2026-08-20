import { ApiProperty } from '@nestjs/swagger';

/**
 * Respostas do grafo de conhecimento (`internal-graph.controller.ts`) —
 * contrato FECHADO com a frente paralela do engine, por isso estas duas
 * classes NÃO espelham `PromptVersion` inteiro (que também tem `createdAt`):
 * a forma exata é a que o contrato descreve, nem mais nem menos.
 */

/** `GET /internal/graph/prompt-templates/:name` — sem `active`, por contrato. */
export class PromptTemplateReadResponseDto {
  @ApiProperty({ example: 'dev-agent-kickoff' }) name!: string;
  @ApiProperty({ example: '3' }) version!: string;
  @ApiProperty({ example: 'Você é o dev agent do módulo {{modulo}}...' })
  body!: string;
  @ApiProperty({ example: 'sha256:9f2c...' }) hash!: string;
}

/** `POST /internal/graph/prompt-templates` — com `active`, por contrato. */
export class PromptTemplateResponseDto {
  @ApiProperty({ example: 'dev-agent-kickoff' }) name!: string;
  @ApiProperty({ example: '3' }) version!: string;
  @ApiProperty({ example: 'Você é o dev agent do módulo {{modulo}}...' })
  body!: string;
  @ApiProperty({ example: 'sha256:9f2c...' }) hash!: string;
  @ApiProperty({
    description:
      'Se esta é a versão vigente do template. Sempre `true` logo depois de ' +
      'um upsert que criou versão nova; pode voltar `false` quando o hit de ' +
      'idempotência (mesmo hash) aponta para uma versão que uma publicação ' +
      'POSTERIOR já desativou.',
  })
  active!: boolean;
}
