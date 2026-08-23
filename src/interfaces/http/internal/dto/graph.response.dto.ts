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
  @ApiProperty({ example: 'You are the dev agent for the {{modulo}} module...' })
  body!: string;
  @ApiProperty({ example: 'sha256:9f2c...' }) hash!: string;
}

/** `POST /internal/graph/prompt-templates` — com `active`, por contrato. */
export class PromptTemplateResponseDto {
  @ApiProperty({ example: 'dev-agent-kickoff' }) name!: string;
  @ApiProperty({ example: '3' }) version!: string;
  @ApiProperty({ example: 'You are the dev agent for the {{modulo}} module...' })
  body!: string;
  @ApiProperty({ example: 'sha256:9f2c...' }) hash!: string;
  @ApiProperty({
    description:
      'Whether this is the current version of the template. Always `true` ' +
      'right after an upsert that created a new version; can come back ' +
      '`false` when the idempotency hit (same hash) points to a version ' +
      'that a LATER publish already deactivated.',
  })
  active!: boolean;
}
