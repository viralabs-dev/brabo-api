import { Injectable, NotFoundException } from '@nestjs/common';
import type { CredentialProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';

@Injectable()
export class DeleteUserCredentialUseCase {
  constructor(private readonly credentials: UserCredentialRepository) {}

  async execute(
    userId: string,
    provider: CredentialProviderName,
  ): Promise<void> {
    const deleted = await this.credentials.delete(userId, provider);
    if (!deleted) throw new NotFoundException('Credencial não encontrada');
  }
}
