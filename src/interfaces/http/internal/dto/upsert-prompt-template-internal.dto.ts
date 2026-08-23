import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** `POST /internal/graph/prompt-templates` — contrato fechado com o engine. */
export class UpsertPromptTemplateInternalDto {
  @ApiProperty({ example: 'dev-agent-kickoff' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '3' })
  @IsString()
  @MinLength(1)
  version!: string;

  @ApiProperty({ example: 'You are the dev agent for the {{modulo}} module...' })
  @IsString()
  @MinLength(1)
  body!: string;

  @ApiProperty({ example: 'sha256:9f2c...' })
  @IsString()
  @MinLength(1)
  hash!: string;
}
