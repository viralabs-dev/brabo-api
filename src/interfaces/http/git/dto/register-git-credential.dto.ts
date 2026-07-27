import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { GitCredentialProviderName } from '@brabo/shared';

export class RegisterGitCredentialDto {
  @ApiProperty({ enum: ['github', 'gitlab'], example: 'github' })
  @IsIn(['github', 'gitlab'])
  provider!: GitCredentialProviderName;

  @ApiProperty({
    example: 'ghp_…',
    description:
      'Personal access token. É TESTADO contra o provider antes de ser persistido — ' +
      'token inválido responde erro em vez de ser guardado para falhar depois. ' +
      'Cifrado por envelope encryption e nunca devolvido.',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
