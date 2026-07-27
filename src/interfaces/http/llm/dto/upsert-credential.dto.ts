import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { LLMProviderName } from '@brabo/shared';

export class UpsertCredentialDto {
  @ApiProperty({ enum: ['anthropic', 'openai'], example: 'anthropic' })
  @IsIn(['anthropic', 'openai'])
  provider!: Extract<LLMProviderName, 'anthropic' | 'openai'>;

  @ApiProperty({
    example: 'sk-ant-api03-…',
    description:
      'A chave em texto plano. É cifrada por envelope encryption antes de tocar o ' +
      'banco e NUNCA volta em resposta nenhuma — nem cifrada.',
  })
  @IsString()
  @IsNotEmpty()
  apiKey!: string;
}
