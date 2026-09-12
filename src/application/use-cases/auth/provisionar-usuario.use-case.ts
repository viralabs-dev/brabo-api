import { Injectable } from '@nestjs/common';
import { AuthCredentialRepository } from '../../ports/auth-credential-repository.port';
import { PasswordHasher } from '../../ports/password-hasher.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { normalizarEmail } from '../../../domain/auth/email';
import type { User } from '../../../domain/iam/user.entity';

/**
 * Cria (ou reaproveita) um usuário com senha já verificada (ADR 0155).
 *
 * ## Por que isto virou caso de uso
 *
 * O corpo desta função morava em `scripts/provisionar-usuario.ts`, junto com
 * uma recusa de rodar em produção. As duas coisas não são a mesma: a recusa
 * protege um CHAMADOR (um script de desenvolvimento que cria conta com senha
 * CONHECIDA e SEM interação humana — é o que o docblock de lá diz, com todas
 * as letras), enquanto o que está aqui é só o trio de escritas que faz uma
 * conta nascer verificada.
 *
 * `CriarPrimeiraContaUseCase` (RN-546) precisa do trio e é outra categoria de
 * chamador: a senha é escolhida por um humano no TTY, lida sem eco e
 * confirmada, atrás do `BRABO_SERVICE_TOKEN`, e só quando não há usuário
 * nenhum. Extrair foi a alternativa a `BRABO_FORCE_SEED` — burlar a recusa
 * teria feito o instalador se declarar "seed forçado" para atravessar uma
 * regra que nunca falava dele, e apagado a recusa exatamente onde ela vale.
 *
 * ## O que NÃO está aqui
 *
 * A recusa de produção: ela ficou no script, que é quem ela protege.
 *
 * E o workspace pessoal (RN-410): este caso de uso é o trio de escritas da
 * CREDENCIAL, e o seed de demonstração — que já cria o workspace dele
 * explicitamente — ganharia dois workspaces pessoais a mais se o trio os
 * criasse. Quem cria conta nova e precisa do workspace o cria na MESMA
 * transação, como `RegisterUseCase` e `SocialLoginCallbackUseCase` já fazem.
 *
 * ## Idempotente
 *
 * Se o e-mail já existe, devolve o usuário e não mexe na senha. Rodar de novo
 * depois de alguém ter trocado a própria senha não a reverte.
 */
@Injectable()
export class ProvisionarUsuarioUseCase {
  constructor(
    private readonly credenciais: AuthCredentialRepository,
    private readonly hasher: PasswordHasher,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(entrada: {
    email: string;
    nome: string | null;
    senha: string;
  }): Promise<{ user: User; criado: boolean }> {
    const email = normalizarEmail(entrada.email);

    const existente = await this.credenciais.findByEmail(email);
    if (existente) {
      return {
        user: {
          id: existente.userId,
          keycloakSub: null,
          email: existente.email,
          name: entrada.nome,
          // Sintético — este ramo não lê o usuário de verdade (só a
          // credencial), e locale não interessa a nenhum chamador.
          locale: 'pt-BR',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        criado: false,
      };
    }

    const passwordHash = await this.hasher.hash(entrada.senha);

    // `runInTransaction` é REENTRANTE (ver `DrizzleUnitOfWork`): quando quem
    // chama já abriu uma transação — é o caso de `CriarPrimeiraContaUseCase`,
    // que precisa da conta e do workspace pessoal no mesmo commit — esta aqui
    // é reusada em vez de abrir uma segunda.
    return this.unitOfWork.runInTransaction(async () => {
      const criada = await this.credenciais.criarUsuarioComCredencial({
        email,
        name: entrada.nome,
        passwordHash,
      });
      await this.credenciais.marcarEmailVerificado(criada.userId);

      return {
        user: {
          id: criada.userId,
          keycloakSub: null,
          email: criada.email,
          name: entrada.nome,
          // Sintético, mesma nota do outro ramo — a linha recém-criada usa o
          // default do banco ('pt-BR'), e nada aqui lê o valor real.
          locale: 'pt-BR',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        criado: true,
      };
    });
  }
}
