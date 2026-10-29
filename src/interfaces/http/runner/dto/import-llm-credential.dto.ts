import type { LLMProviderName } from '@brabo/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LLM_PROVIDER_NAMES_COM_CREDENCIAL } from '../../../../domain/llm/llm-provider-names';
import { CREDENCIAL_COMPRIMENTO_MAXIMO } from '../../../../domain/llm/user-credential.entity';

type Provider = (typeof LLM_PROVIDER_NAMES_COM_CREDENCIAL)[number];

export class ImportLlmCredentialDto {
  @ApiProperty({
    enum: LLM_PROVIDER_NAMES_COM_CREDENCIAL,
    example: 'anthropic',
  })
  @IsIn(LLM_PROVIDER_NAMES_COM_CREDENCIAL)
  provider!: Provider;

  @ApiProperty({
    maxLength: CREDENCIAL_COMPRIMENTO_MAXIMO,
    description:
      'The API key in plain text. Encrypted before touching the database; ' +
      'NEVER logged and NEVER returned.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CREDENCIAL_COMPRIMENTO_MAXIMO)
  apiKey!: string;

  @ApiProperty({
    example: 'codex: ~/.codex/auth.json',
    maxLength: 200,
    description:
      'Tool and path the key was read from. Audit log only; never a value.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  origem!: string;

  @ApiPropertyOptional({
    description:
      'Must be `true` to replace an existing credential of this provider.',
  })
  @IsOptional()
  @IsBoolean()
  substituir?: boolean;
}

export class ImportLlmCredentialResponseDto {
  @ApiProperty({ enum: LLM_PROVIDER_NAMES_COM_CREDENCIAL })
  provider!: LLMProviderName;

  @ApiProperty({ description: 'Whether an existing credential was replaced.' })
  substituida!: boolean;
}
