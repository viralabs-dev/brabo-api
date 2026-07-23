import type { User } from '../../domain/iam/user.entity';

export interface UpsertUserInput {
  keycloakSub: string;
  email: string;
  name: string | null;
}

export abstract class UserRepository {
  abstract upsertFromKeycloak(input: UpsertUserInput): Promise<User>;
  abstract findById(id: string): Promise<User | null>;
}
