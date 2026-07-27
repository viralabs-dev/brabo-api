import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  PasswordHasher,
  type ParametrosArgon2,
} from '../../application/ports/password-hasher.port';
import { saltDoDummy } from './auth-key-material';

/**
 * argon2id (Fase 7a, item 1).
 *
 * ## Os parâmetros
 *
 * `m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, saída de 32 bytes — o segundo
 * perfil recomendado pelo OWASP. Roda em ~50 ms em CPU modesta e cabe no
 * limite de memória do container da api mesmo com várias verificações
 * concorrentes.
 *
 * Ficam em CONSTANTE, não em variável de ambiente, de propósito. Mudar custo
 * de hash não é ajuste de tuning: é uma decisão que exige plano de re-hash do
 * acervo. Exposto como env, vira a alavanca que alguém baixa em produção para
 * "melhorar a latência do login" e ninguém percebe que a proteção caiu.
 *
 * ## O hash dummy
 *
 * Existe para o login gastar o MESMO tempo quando o e-mail não existe. Três
 * detalhes que parecem menores e não são:
 *
 * - é gerado com `PARAMS`, o mesmo objeto do hash real. Um dummy literal
 *   colado no código envelhece em silêncio quando os parâmetros mudam, e a
 *   assimetria de tempo volta sem ninguém notar;
 * - o salt é determinístico (derivado da passphrase), não aleatório. Não é
 *   requisito de segurança — é para o valor ser estável entre reinícios e
 *   réplicas, e reproduzível no teste;
 * - é memoizado. Recalcular a cada requisição dobraria o custo do ramo de
 *   e-mail inexistente e reintroduziria a assimetria, ao contrário.
 */
export const PARAMS: ParametrosArgon2 = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * `Algorithm.Argon2id` do @node-rs/argon2, pelo valor.
 *
 * O enum da lib é `const enum` ambiente, e o tsconfig deste projeto usa
 * `isolatedModules` — importar o símbolo não compila. Passar o valor explícito
 * é melhor do que confiar no default da biblioteca: argon2id HOJE é o default,
 * mas isso é decisão de terceiro, e o dia em que mudar a regressão seria
 * silenciosa. O teste `usa argon2id` confere o prefixo do hash gerado, que é
 * a trava de verdade.
 */
const ARGON2ID = 2;

const SENHA_DO_DUMMY = 'brabo-dummy-password-never-a-real-credential';

@Injectable()
export class Argon2PasswordHasher
  extends PasswordHasher
  implements OnModuleInit
{
  private readonly logger = new Logger(Argon2PasswordHasher.name);
  readonly params = PARAMS;

  private dummy: string | null = null;

  get dummyHash(): string {
    if (this.dummy === null) {
      throw new Error(
        'dummyHash acessado antes do onModuleInit — o hasher não terminou de subir',
      );
    }
    return this.dummy;
  }

  /**
   * Gera o dummy e confere que a ligação nativa funciona.
   *
   * A checagem no boot não é zelo: `@node-rs/argon2` é binário pré-compilado,
   * e uma imagem que resolveu o pacote errado (glibc numa base musl) só falha
   * na PRIMEIRA tentativa de login. Falhar na subida transforma isso num pod
   * que não fica pronto, que é onde o problema é barato.
   */
  async onModuleInit(): Promise<void> {
    this.dummy = await hash(SENHA_DO_DUMMY, {
      ...PARAMS,
      algorithm: ARGON2ID,
      outputLen: 32,
      salt: saltDoDummy(),
    });

    if (!(await this.verify(this.dummy, SENHA_DO_DUMMY))) {
      throw new Error(
        'argon2id não verifica o próprio hash — ligação nativa quebrada',
      );
    }
    this.logger.log('argon2id pronto (m=19456, t=2, p=1)');
  }

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, {
      ...PARAMS,
      algorithm: ARGON2ID,
      outputLen: 32,
    });
  }

  /**
   * `verify` do @node-rs/argon2 LANÇA quando o hash codificado é malformado,
   * e só devolve `false` quando a senha está errada. Deixar a exceção subir
   * transformaria o ramo de e-mail inexistente (que verifica contra o dummy)
   * num 500 — um oráculo ainda mais barulhento do que o que se quer fechar.
   */
  async verify(encoded: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(encoded, plaintext);
    } catch {
      return false;
    }
  }
}

/** Lê `m`, `t` e `p` de um hash codificado. Usado pelos testes. */
export function parametrosDoHash(encoded: string): ParametrosArgon2 | null {
  const m = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(encoded);
  if (!m) return null;
  return {
    memoryCost: Number(m[1]),
    timeCost: Number(m[2]),
    parallelism: Number(m[3]),
  };
}
