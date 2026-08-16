import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  AuthCredentialRepository,
  type AuthCredential,
  type UsuarioComCredencial,
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
   * LEFT JOIN de `users` para `auth_credentials`, numa consulta só.
   *
   * A direção importa: partir de `users` é o que faz o usuário SEM credencial
   * (conta migrada do Keycloak) aparecer. Partindo da credencial, ele seria
   * indistinguível de um e-mail que nunca existiu — e o login não teria como
   * disparar o e-mail de "definir senha".
   *
   * Compara por `lower(email)`, a mesma expressão do índice único
   * `users_email_lower_idx`: é o que faz o planejador usar o índice e o que
   * garante que busca e unicidade concordem.
   */
  async findByEmail(
    emailNormalizado: string,
  ): Promise<UsuarioComCredencial | null> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select({
        userId: users.id,
        email: users.email,
        credencialId: authCredentials.id,
        passwordHash: authCredentials.passwordHash,
        passwordUpdatedAt: authCredentials.passwordUpdatedAt,
        emailVerifiedAt: authCredentials.emailVerifiedAt,
        disabledAt: authCredentials.disabledAt,
      })
      .from(users)
      .leftJoin(authCredentials, eq(authCredentials.userId, users.id))
      .where(sql`lower(${users.email}) = ${emailNormalizado}`)
      .limit(1);

    if (!linha) return null;

    return {
      userId: linha.userId,
      email: linha.email,
      credencial: linha.credencialId
        ? {
            id: linha.credencialId,
            userId: linha.userId,
            passwordHash: linha.passwordHash!,
            passwordUpdatedAt: linha.passwordUpdatedAt!,
            emailVerifiedAt: linha.emailVerifiedAt,
            disabledAt: linha.disabledAt,
          }
        : null,
    };
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
   * existiu no Keycloak.
   *
   * Precisa rodar dentro de transação — duas escritas em tabelas diferentes, e
   * um usuário sem credencial seria indistinguível de uma conta migrada, com o
   * agravante de bloquear o próprio e-mail pelo índice único.
   */
  async criarUsuarioComCredencial(entrada: {
    email: string;
    name: string | null;
    passwordHash: string;
  }): Promise<UsuarioComCredencial> {
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
      userId: usuario.id,
      email: usuario.email,
      credencial: {
        id: credencial.id,
        userId: credencial.userId,
        passwordHash: credencial.passwordHash,
        passwordUpdatedAt: credencial.passwordUpdatedAt,
        emailVerifiedAt: credencial.emailVerifiedAt,
        disabledAt: credencial.disabledAt,
      },
    };
  }

  /**
   * Cria um usuário SEM credencial — login social (RN-278, ADR 0084).
   *
   * `keycloakSub` fica NULL, igual ao registro normal: esta conta não veio do
   * Keycloak, só compartilha com ele a FORMA de "senha pendente" (nenhuma
   * linha em `auth_credentials`).
   */
  async criarUsuarioSemCredencial(entrada: {
    email: string;
    name: string | null;
  }): Promise<{ userId: string; email: string }> {
    const db = currentDb(this.rootDb);
    const [usuario] = await db
      .insert(users)
      .values({ email: entrada.email, name: entrada.name })
      .returning();
    return { userId: usuario.id, email: usuario.email };
  }

  /**
   * Define a senha do usuário — criando a credencial se ela não existir.
   *
   * É UPSERT e não UPDATE por causa da migração: o usuário importado do
   * Keycloak não tem linha em `auth_credentials`, e um UPDATE simplesmente
   * afetaria zero linhas. O fluxo terminaria "com sucesso", o usuário
   * continuaria sem senha, e o sintoma seria ele não conseguir entrar depois
   * de definir a senha — sem erro em lugar nenhum.
   */
  async trocarSenha(userId: string, passwordHash: string): Promise<void> {
    const db = currentDb(this.rootDb);
    const agora = new Date();
    await db
      .insert(authCredentials)
      .values({ userId, passwordHash })
      .onConflictDoUpdate({
        target: authCredentials.userId,
        set: { passwordHash, passwordUpdatedAt: agora, updatedAt: agora },
      });
  }

  async marcarEmailVerificado(userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    const agora = new Date();
    await db
      .update(authCredentials)
      .set({ emailVerifiedAt: agora, updatedAt: agora })
      .where(eq(authCredentials.userId, userId));
  }

  /**
   * Quem veio do Keycloak (`keycloak_sub` preenchido) e ainda não tem senha.
   *
   * A coluna `keycloak_sub` sobrevive ao corte justamente para isto: é a única
   * evidência de procedência que resta, e sem ela não há como distinguir
   * "conta migrada esperando senha" de "conta criada e abandonada no meio do
   * registro". Some numa migração posterior, quando a migração tiver assentado.
   */
  async listarPendentesDeSenha(): Promise<{ userId: string; email: string }[]> {
    const db = currentDb(this.rootDb);
    return db
      .select({ userId: users.id, email: users.email })
      .from(users)
      .leftJoin(authCredentials, eq(authCredentials.userId, users.id))
      .where(and(isNotNull(users.keycloakSub), isNull(authCredentials.id)));
  }
}
