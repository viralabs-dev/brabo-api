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
      'Personal access token. Cifrado por envelope encryption antes de tocar o banco ' +
      'e nunca devolvido, nem cifrado. O cadastro NÃO testa o token (ADR 0050) — ' +
      'para verificá-lo use `POST /users/me/credentials/{provider}/test`. O teto de ' +
      `${CREDENCIAL_COMPRIMENTO_MAXIMO} caracteres é proteção contra payload absurdo, ` +
      'não validação de formato.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CREDENCIAL_COMPRIMENTO_MAXIMO)
  token!: string;
}
