import { ApiProperty } from '@nestjs/swagger';
import { PersonalAccessTokenResponseDto } from './personal-access-token.response.dto';

/** Só esta resposta carrega o token bruto — mostrado exatamente uma vez. */
export class IssuePatResponseDto extends PersonalAccessTokenResponseDto {
  @ApiProperty({
    example: 'brb_9f8a...',
    description:
      'Store it now — it is not recoverable later. Use it in --token or BRABO_ACCOUNT_TOKEN.',
  })
  token!: string;
}
