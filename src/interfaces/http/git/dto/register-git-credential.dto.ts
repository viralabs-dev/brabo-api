import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { GIT_CREDENTIAL_PROVIDER_NAMES } from '../../../../domain/git/git-credential-provider-names';
import { CREDENCIAL_COMPRIMENTO_MAXIMO } from '../../../../domain/llm/user-credential.entity';

export class RegisterGitCredentialDto {
  @ApiProperty({ enum: GIT_CREDENTIAL_PROVIDER_NAMES, example: 'github' })
  @IsIn(GIT_CREDENTIAL_PROVIDER_NAMES)
  provider!: (typeof GIT_CREDENTIAL_PROVIDER_NAMES)[number];

  @ApiProperty({
    example: 'ghp_…',
    maxLength: CREDENCIAL_COMPRIMENTO_MAXIMO,
    description:
      'Personal access token. Encrypted by envelope encryption before ' +
      'touching the database and never returned, not even encrypted. ' +
      'Registration does NOT test the token (ADR 0050) — to verify it use ' +
      '`POST /users/me/credentials/{provider}/test`. The ' +
      `${CREDENCIAL_COMPRIMENTO_MAXIMO}-character cap is protection against ` +
      'an absurd payload, not format validation.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CREDENCIAL_COMPRIMENTO_MAXIMO)
  token!: string;
}
