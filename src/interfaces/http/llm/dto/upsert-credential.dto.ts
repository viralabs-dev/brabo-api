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
      'The key in plain text. It is encrypted via envelope encryption before ' +
      'touching the database and NEVER comes back in any response — not even ' +
      `encrypted. The ${CREDENCIAL_COMPRIMENTO_MAXIMO}-character cap is ` +
      'protection against an absurd payload, not format validation: whether ' +
      'the key is any good is answered by the provider, at ' +
      '`POST /users/me/credentials/{provider}/test`.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CREDENCIAL_COMPRIMENTO_MAXIMO)
  apiKey!: string;
}
