import { Injectable } from '@nestjs/common';
import {
  UserRepository,
  type UpsertUserInput,
} from '../../ports/user-repository.port';
import type { User } from '../../../domain/iam/user.entity';

@Injectable()
export class SyncUserUseCase {
  constructor(private readonly users: UserRepository) {}

  /** Cria o usuário no primeiro login; em logins seguintes, atualiza email/nome. */
  execute(input: UpsertUserInput): Promise<User> {
    return this.users.upsertFromKeycloak(input);
  }
}
