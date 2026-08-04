import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { LLM_PROVIDER_NAMES_COM_CREDENCIAL } from '../../../../domain/llm/llm-provider-names';
import { CREDENCIAL_COMPRIMENTO_MAXIMO } from '../../../../domain/llm/user-credential.entity';

export class UpsertCredentialDto {
  @ApiProperty({
    enum: LLM_PROVIDER_NAMES_COM_CREDENCIAL,
    example: 'anthropic',
  })
  @IsIn(LLM_PROVIDER_NAMES_COM_CREDENCIAL)
  provider!: (typeof LLM_PROVIDER_NAMES_COM_CREDENCIAL)[number];

  @ApiProperty({
    example: 'sk-ant-api03-…',
    maxLength: CREDENCIAL_COMPRIMENTO_MAXIMO,
    description:
      'A chave em texto plano. É cifrada por envelope encryption antes de tocar o ' +
      'banco e NUNCA volta em resposta nenhuma — nem cifrada. O teto de ' +
      `${CREDENCIAL_COMPRIMENTO_MAXIMO} caracteres é proteção contra payload absurdo, ` +
      'não validação de formato: se a chave presta ou não, quem responde é o ' +
      'provider em `POST /users/me/credentials/{provider}/test`.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CREDENCIAL_COMPRIMENTO_MAXIMO)
  apiKey!: string;
}
