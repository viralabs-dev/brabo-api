import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { GitCredentialProviderName } from '@brabo/shared';

export class RegisterGitCredentialDto {
  @IsIn(['github', 'gitlab'])
  provider!: GitCredentialProviderName;

  @IsString()
  @IsNotEmpty()
  token!: string;
}
