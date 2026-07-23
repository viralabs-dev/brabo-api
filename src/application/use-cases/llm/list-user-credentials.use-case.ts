import { Injectable } from '@nestjs/common';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';

@Injectable()
export class ListUserCredentialsUseCase {
  constructor(private readonly credentials: UserCredentialRepository) {}

  execute(userId: string) {
    return this.credentials.listMetadataForUser(userId);
  }
}
