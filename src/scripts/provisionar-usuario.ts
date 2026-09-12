import type { INestApplicationContext } from '@nestjs/common';
import { ProvisionarUsuarioUseCase } from '../application/use-cases/auth/provisionar-usuario.use-case';
import type { User } from '../domain/iam/user.entity';

/**
 * Cria (ou reaproveita) um usuário com senha já verificada, PARA AUTOMAÇÃO.
 *
 * Existe porque, sem Keycloak, não há mais de onde tirar uma credencial para
 * automação: o seed de demonstração e o smoke test precisavam de um usuário
 * que consiga fazer login, e o fluxo normal de registro exige verificar
 * e-mail — que com o `MailSender` log-only não fecha sozinho.
 *
 * Isto é ferramenta de DESENVOLVIMENTO. Criar conta com senha conhecida, já
 * verificada e SEM INTERAÇÃO HUMANA é exatamente o que não se quer em
 * produção; daí a recusa explícita abaixo, que precisa ser burlada de
 * propósito para rodar lá.
 *
 * ## O que esta função é hoje, e o que ela deixou de ser (ADR 0155)
 *
 * Ela é a RECUSA. O trio de escritas que faz a conta nascer verificada mudou
 * para `ProvisionarUsuarioUseCase`, e aqui só sobrou o que a recusa protege:
 * este chamador, que escolhe a senha sozinho.
 *
 * A separação foi o que permitiu o instalador (RN-546) criar a primeira conta
 * em produção sem `BRABO_FORCE_SEED`. Ele não é este caso: a senha é escolhida
 * por um humano no TTY, lida sem eco e confirmada, atrás do
 * `BRABO_SERVICE_TOKEN`, e só quando a instalação não tem usuário nenhum.
 * Mandá-lo se declarar "seed forçado" o faria atravessar uma regra que nunca
 * falou dele — e afrouxaria a recusa justamente onde ela vale.
 *
 * Idempotente: se o e-mail já existe, devolve o usuário e não mexe na senha.
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

  return app.get(ProvisionarUsuarioUseCase).execute(entrada);
}
