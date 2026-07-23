import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { LLMProviderName } from '@brabo/shared';

export class UpsertCredentialDto {
  @IsIn(['anthropic', 'openai'])
  provider!: Extract<LLMProviderName, 'anthropic' | 'openai'>;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;
}
