import type { INestApplicationContext } from '@nestjs/common';
import { AuthCredentialRepository } from '../application/ports/auth-credential-repository.port';
import { PasswordHasher } from '../application/ports/password-hasher.port';
import { UnitOfWork } from '../application/ports/unit-of-work.port';
import { normalizarEmail } from '../domain/auth/email';
import type { User } from '../domain/iam/user.entity';

/**
 * Cria (ou reaproveita) um usuário com senha já verificada.
 *
 * Existe porque, sem Keycloak, não há mais de onde tirar uma credencial para
 * automação: o seed de demonstração e o smoke test precisavam de um usuário
 * que consiga fazer login, e o fluxo normal de registro exige verificar
 * e-mail — que com o `MailSender` log-only não fecha sozinho.
 *
 * Isto é ferramenta de DESENVOLVIMENTO. Criar conta com senha conhecida, já
 * verificada e sem interação humana é exatamente o que não se quer em
 * produção; daí a recusa explícita abaixo, que precisa ser burlada de
 * propósito para rodar lá.
 *
 * Idempotente: se o e-mail já existe, devolve o usuário e não mexe na senha.
 * Rodar de novo depois de alguém ter trocado a própria senha não a reverte.
 */
export async function provisionarUsuario(
  app: INestApplicationContext,
  entrada: { email: string; nome: string | null; senha: string },
): Promise<{ user: User; criado: boolean }> {
  if (process.env.NODE_ENV === 'production' && !process.env.BRABO_FORCE_SEED) {
    throw new Error(
      'provisionarUsuario recusa rodar com NODE_ENV=production: cria conta com ' +
        'senha conhecida e e-mail já verificado. Defina BRABO_FORCE_SEED=1 se ' +
        'você realmente sabe o que está fazendo.',
    );
  }

  const credenciais = app.get(AuthCredentialRepository);
  const hasher = app.get(PasswordHasher);
  const unitOfWork = app.get(UnitOfWork);
  const email = normalizarEmail(entrada.email);

  const existente = await credenciais.findByEmail(email);
  if (existente) {
    return {
      user: {
        id: existente.userId,
        keycloakSub: null,
        email: existente.email,
        name: entrada.nome,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      criado: false,
    };
  }

  const passwordHash = await hasher.hash(entrada.senha);

  return unitOfWork.runInTransaction(async () => {
    const criada = await credenciais.criarUsuarioComCredencial({
      email,
      name: entrada.nome,
      passwordHash,
    });
    await credenciais.marcarEmailVerificado(criada.userId);

    return {
      user: {
        id: criada.userId,
        keycloakSub: null,
        email: criada.email,
        name: entrada.nome,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      criado: true,
    };
  });
}
