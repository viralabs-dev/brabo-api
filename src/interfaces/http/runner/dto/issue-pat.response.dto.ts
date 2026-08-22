import { ApiProperty } from '@nestjs/swagger';
import { PersonalAccessTokenResponseDto } from './personal-access-token.response.dto';

/** Só esta resposta carrega o token bruto — mostrado exatamente uma vez. */
export class IssuePatResponseDto extends PersonalAccessTokenResponseDto {
  @ApiProperty({
    example: 'brb_9f8a...',
    description:
      'Guarde agora — não é recuperável depois. Use em --token ou BRABO_ACCOUNT_TOKEN.',
  })
  token!: string;
}
