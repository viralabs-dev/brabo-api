import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  AuthCredentialRepository,
  type AuthCredential,
  type CredencialComUsuario,
} from '../../../application/ports/auth-credential-repository.port';
import { authCredentials, users } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAuthCredentialRepository extends AuthCredentialRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  /**
   * Busca por `lower(email)` — a mesma expressão do índice único
   * `users_email_lower_idx`, para o planejador usar o índice e para a busca
   * concordar com a unicidade. Comparar a coluna crua aqui faria o índice
   * expressão ser ignorado E deixaria "Ana@" e "ana@" divergirem entre
   * cadastro e login.
   */
  async findByEmail(
    emailNormalizado: string,
  ): Promise<CredencialComUsuario | null> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select({
        id: authCredentials.id,
        userId: authCredentials.userId,
        passwordHash: authCredentials.passwordHash,
        passwordUpdatedAt: authCredentials.passwordUpdatedAt,
        emailVerifiedAt: authCredentials.emailVerifiedAt,
        disabledAt: authCredentials.disabledAt,
        email: users.email,
      })
      .from(authCredentials)
      .innerJoin(users, eq(users.id, authCredentials.userId))
      .where(sql`lower(${users.email}) = ${emailNormalizado}`)
      .limit(1);

    return linha ?? null;
  }

  async findByUserId(userId: string): Promise<AuthCredential | null> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select()
      .from(authCredentials)
      .where(eq(authCredentials.userId, userId))
      .limit(1);

    if (!linha) return null;
    return {
      id: linha.id,
      userId: linha.userId,
      passwordHash: linha.passwordHash,
      passwordUpdatedAt: linha.passwordUpdatedAt,
      emailVerifiedAt: linha.emailVerifiedAt,
      disabledAt: linha.disabledAt,
    };
  }

  /**
   * Cria usuário e credencial.
   *
   * `keycloakSub` fica NULL: esta conta nasce no auth first-party e nunca
   * existiu no Keycloak. É o que a coluna nullable da migração 0023 permite.
   *
   * Precisa rodar dentro de transação — duas escritas em tabelas diferentes,
   * e um usuário sem credencial seria uma conta em que ninguém consegue
   * entrar e que bloqueia o próprio e-mail pelo índice único.
   */
  async criarUsuarioComCredencial(entrada: {
    email: string;
    name: string | null;
    passwordHash: string;
  }): Promise<CredencialComUsuario> {
    const db = currentDb(this.rootDb);

    const [usuario] = await db
      .insert(users)
      .values({ email: entrada.email, name: entrada.name })
      .returning();

    const [credencial] = await db
      .insert(authCredentials)
      .values({ userId: usuario.id, passwordHash: entrada.passwordHash })
      .returning();

    return {
      id: credencial.id,
      userId: credencial.userId,
      passwordHash: credencial.passwordHash,
      passwordUpdatedAt: credencial.passwordUpdatedAt,
      emailVerifiedAt: credencial.emailVerifiedAt,
      disabledAt: credencial.disabledAt,
      email: usuario.email,
    };
  }

  async trocarSenha(userId: string, passwordHash: string): Promise<void> {
    const db = currentDb(this.rootDb);
    const agora = new Date();
    await db
      .update(authCredentials)
      .set({ passwordHash, passwordUpdatedAt: agora, updatedAt: agora })
      .where(eq(authCredentials.userId, userId));
  }

  async marcarEmailVerificado(userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    const agora = new Date();
    await db
      .update(authCredentials)
      .set({ emailVerifiedAt: agora, updatedAt: agora })
      .where(eq(authCredentials.userId, userId));
  }
}
