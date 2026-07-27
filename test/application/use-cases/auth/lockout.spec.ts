import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { authEvents } from '../../../../src/db/schema';
import { baldeDeEmail } from '../../../../src/infrastructure/security/auth-key-material';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

let h: Harness;

const DE_UM_IP = { contexto: { ip: '203.0.113.7' } };

beforeAll(async () => {
  h = await montarHarness();
}, 60_000);

beforeEach(async () => {
  await h.limpar();
  await h.db.execute(sql`TRUNCATE TABLE auth_lockout_hits RESTART IDENTITY`);
  h.mail.limpar();
  h.hasher.limpar();
});

afterAll(async () => {
  await h.pool.end();
});

async function errarSenha(vezes: number, extra: object = {}) {
  for (let i = 0; i < vezes; i++) {
    await h.login
      .execute({ email: EMAIL, senha: 'errada mas comprida', ...extra })
      .catch(() => {});
  }
}

async function contarEventos(kind: string) {
  const linhas = await h.db
    .select()
    .from(authEvents)
    .where(eq(authEvents.kind, kind));
  return linhas.length;
}

describe('lockout por usuário', () => {
  it('caminho feliz: quatro erros ainda deixam entrar com a senha certa', async () => {
    await contaPronta(h);
    await errarSenha(4);

    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });

  it('na quinta falha a conta trava, mesmo com a senha CERTA', async () => {
    await contaPronta(h);
    await errarSenha(5);

    // A sexta tentativa é a primeira barrada — a quinta ainda foi avaliada.
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).rejects.toThrow();
    expect(await contarEventos('login_blocked_user')).toBeGreaterThan(0);
  });

  it('o login bem-sucedido zera o contador, sem apagar a trilha', async () => {
    await contaPronta(h);
    await errarSenha(4);
    await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    // Contador zerado: dá para errar mais quatro vezes sem travar.
    await errarSenha(4);
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();

    // E a trilha continua inteira — é a razão de auth_events e
    // auth_lockout_hits serem tabelas separadas.
    expect(await contarEventos('login_failure')).toBe(8);
  });

  it('travado, tentar de novo NÃO prorroga o bloqueio', async () => {
    // Se prorrogasse, um atacante manteria a conta da vítima travada para
    // sempre só continuando a tentar: lockout viraria negação de serviço
    // contra quem ele deveria proteger.
    await contaPronta(h);
    await errarSenha(6);

    const antes = await h.throttle.consultar(baldeDeEmail(EMAIL));
    await errarSenha(10);
    const depois = await h.throttle.consultar(baldeDeEmail(EMAIL));

    expect(depois.falhas).toBe(antes.falhas);
  });

  it('travar uma conta não trava outra', async () => {
    await contaPronta(h);
    await contaPronta(h, 'outro@brabo.dev');
    await errarSenha(6);

    await expect(
      h.login.execute({ email: 'outro@brabo.dev', senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });

  it('conta o e-mail INEXISTENTE também', async () => {
    // É o que impede o próprio lockout de virar oráculo de existência: se o
    // balde só existisse depois de achar a conta, bastaria comparar o
    // comportamento na sexta tentativa para saber se o endereço é real.
    // Seis, não cinco: o bloqueio vale a partir da tentativa SEGUINTE à que
    // atinge o limiar — ver EstadoDoBalde.bloqueadoAte.
    for (let i = 0; i < 6; i++) {
      await h.login
        .execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA })
        .catch(() => {});
    }

    expect(await contarEventos('login_blocked_user')).toBeGreaterThan(0);
  });
});

describe('lockout por IP', () => {
  it('pulveriza entre contas e ainda assim é barrado', async () => {
    // O balde do e-mail não pega este caso: cada conta recebe poucas
    // tentativas. Quem pega é o de IP.
    for (let i = 0; i < 25; i++) {
      await h.login
        .execute({
          email: `alvo${i}@brabo.dev`,
          senha: 'chute mas comprido',
          ...DE_UM_IP,
        })
        .catch(() => {});
    }

    expect(await contarEventos('login_blocked_ip')).toBeGreaterThan(0);
  });

  it('o balde de IP barra ANTES do argon2', async () => {
    // Aqui a saída antecipada é correta, e por um motivo oposto ao do e-mail:
    // nada está sendo escondido (o histórico é do próprio requisitante), e
    // rodar argon2 seria entregar a exaustão de CPU que o balde existe para
    // impedir — 19 MiB e um núcleo por tentativa.
    for (let i = 0; i < 21; i++) {
      await h.login
        .execute({ email: `x${i}@brabo.dev`, senha: 'chute comprido', ...DE_UM_IP })
        .catch(() => {});
    }

    h.hasher.limpar();
    await h.login
      .execute({ email: EMAIL, senha: SENHA_BOA, ...DE_UM_IP })
      .catch(() => {});

    expect(h.hasher.verifies).toHaveLength(0);
  });

  it('o sucesso NÃO limpa o balde de IP', async () => {
    // Se limpasse, quem tem uma conta válida zeraria a janela à vontade:
    // logar, pulverizar palpites em outras contas, logar de novo, sem limite.
    await contaPronta(h);
    for (let i = 0; i < 10; i++) {
      await h.login
        .execute({ email: `x${i}@brabo.dev`, senha: 'chute comprido', ...DE_UM_IP })
        .catch(() => {});
    }

    await h.login.execute({ email: EMAIL, senha: SENHA_BOA, ...DE_UM_IP });
    const balde = await h.throttle.consultar('ip:203.0.113.7');

    expect(balde.falhas).toBeGreaterThan(0);
  });

  it('outro IP não é afetado', async () => {
    await contaPronta(h);
    for (let i = 0; i < 25; i++) {
      await h.login
        .execute({ email: `x${i}@brabo.dev`, senha: 'chute comprido', ...DE_UM_IP })
        .catch(() => {});
    }

    await expect(
      h.login.execute({
        email: EMAIL,
        senha: SENHA_BOA,
        contexto: { ip: '198.51.100.9' },
      }),
    ).resolves.toBeTruthy();
  });
});
