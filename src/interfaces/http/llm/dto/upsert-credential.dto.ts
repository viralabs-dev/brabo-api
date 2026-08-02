import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { LLM_PROVIDER_NAMES_COM_CREDENCIAL } from '../../../../domain/llm/llm-provider-names';

export class UpsertCredentialDto {
  @ApiProperty({
    enum: LLM_PROVIDER_NAMES_COM_CREDENCIAL,
    example: 'anthropic',
  })
  @IsIn(LLM_PROVIDER_NAMES_COM_CREDENCIAL)
  provider!: (typeof LLM_PROVIDER_NAMES_COM_CREDENCIAL)[number];

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
