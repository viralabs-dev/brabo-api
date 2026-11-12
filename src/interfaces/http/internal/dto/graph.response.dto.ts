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
  @ApiProperty({
    example: 'You are the dev agent for the {{modulo}} module...',
  })
  body!: string;
  @ApiProperty({ example: 'sha256:9f2c...' }) hash!: string;
}

/** `POST /internal/graph/prompt-templates` — com `active`, por contrato. */
export class PromptTemplateResponseDto {
  @ApiProperty({ example: 'dev-agent-kickoff' }) name!: string;
  @ApiProperty({ example: '3' }) version!: string;
  @ApiProperty({
    example: 'You are the dev agent for the {{modulo}} module...',
  })
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

class InterfaceExpostaDto {
  @ApiProperty({ example: 'criarPedido' }) assinatura!: string;
  @ApiProperty({ example: 'function', nullable: true, type: String })
  tipo!: string | null;
}

class DecisaoCitandoDto {
  @ApiProperty({ example: '0123' }) id!: string;
  @ApiProperty({ example: 'ADR 0123 — pedidos em fila' }) titulo!: string;
}

/** `GET /internal/graph/projects/:projectId/modules/:nome/impacto` (RN-1153). */
export class ImpactoDoModuloResponseDto {
  @ApiProperty() projectId!: string;
  @ApiProperty({ example: 'pedidos' }) modulo!: string;
  @ApiProperty({ nullable: true, type: String, example: 'node-ts' })
  stack!: string | null;
  @ApiProperty({ nullable: true, type: String }) commit!: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Versão do contrato (do banco); null sem contrato declarado.',
  })
  contratoVersao!: number | null;
  @ApiProperty({ type: [String], description: 'Módulos que dependem deste.' })
  dependentes!: string[];
  @ApiProperty({ type: [String], description: 'Módulos de que este depende.' })
  dependeDe!: string[];
  @ApiProperty({ type: [InterfaceExpostaDto] }) expoe!: InterfaceExpostaDto[];
  @ApiProperty({ type: [DecisaoCitandoDto] }) decisoes!: DecisaoCitandoDto[];
}
