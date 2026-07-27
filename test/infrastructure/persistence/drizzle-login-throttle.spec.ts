import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../support/test-db';
import { DrizzleLoginThrottle } from '../../../src/infrastructure/persistence/drizzle/drizzle-login-throttle';

const { db, pool } = createTestDb();
const throttle = new DrizzleLoginThrottle(db);

const BALDE = 'email:teste';

/** Planta uma falha "antiga", para exercitar o recorte da janela. */
async function plantarFalhaAntiga(balde: string, segundosAtras: number) {
  await db.execute(sql`
    insert into auth_lockout_hits (bucket_key, occurred_at)
    values (${balde}, now() - make_interval(secs => ${segundosAtras}))
  `);
}

async function falharVezes(balde: string, vezes: number) {
  let ultimo;
  for (let i = 0; i < vezes; i++) {
    ultimo = await throttle.registrarEContar(balde);
  }
  return ultimo!;
}

beforeEach(async () => {
  await truncateAll(db);
  // auth_lockout_hits não tem FK para users, então o CASCADE do truncateAll
  // não a alcança por herança — ela está na lista explícita, mas limpar aqui
  // também deixa o teste independente da ordem dos arquivos.
  await db.execute(sql`TRUNCATE TABLE auth_lockout_hits RESTART IDENTITY`);
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleLoginThrottle', () => {
  it('caminho feliz: conta a tentativa e não bloqueia abaixo do limiar', async () => {
    const estado = await throttle.registrarEContar(BALDE);

    expect(estado.falhas).toBe(1);
    expect(estado.registrou).toBe(true);
    expect(estado.bloqueadoAte).toBeNull();
  });

  it('a contagem INCLUI a tentativa recém-inserida', async () => {
    // É a soma explícita `+ (select count(*) from novo)` da CTE. Sem ela, a
    // contagem devolveria as tentativas ANTERIORES e o limite valeria um a
    // mais — erro que só aparece na borda, que é o único lugar onde este
    // código importa.
    expect((await throttle.registrarEContar(BALDE)).falhas).toBe(1);
    expect((await throttle.registrarEContar(BALDE)).falhas).toBe(2);
    expect((await throttle.registrarEContar(BALDE)).falhas).toBe(3);
  });

  it('a tentativa que ATINGE o limiar ainda passa; a seguinte é barrada', async () => {
    // `bloqueadoAte` recorta o estado ANTERIOR à tentativa, e isso é o que faz
    // o limiar valer 5 de verdade. Se recortasse o posterior, a quinta
    // tentativa já viria bloqueada — inclusive com a senha certa —, e quem
    // errasse quatro vezes não conseguiria mais entrar até a janela drenar.
    const quinta = await falharVezes(BALDE, 5);
    expect(quinta.falhas).toBe(5);
    expect(quinta.bloqueadoAte).toBeNull();

    const sexta = await throttle.registrarEContar(BALDE);
    expect(sexta.bloqueadoAte).not.toBeNull();
    expect(sexta.bloqueadoAte!.getTime()).toBeGreaterThan(Date.now());
  });

  it('bloqueado, NÃO registra novo hit — senão o lockout vira DoS', async () => {
    // Se registrasse, um atacante manteria a conta da vítima travada para
    // sempre só continuando a tentar: cada tentativa empurraria o bloqueio.
    //
    // As cinco primeiras entram; da sexta em diante o portão da CTE recusa o
    // INSERT. Por isso a contagem CONGELA em 5 por mais que se insista — é a
    // prova de que o bloqueio tem duração fixa a partir da última falha real,
    // e não uma que o atacante consegue empurrar.
    await falharVezes(BALDE, 6);
    const durante = await throttle.registrarEContar(BALDE);

    expect(durante.registrou).toBe(false);
    expect(durante.falhas).toBe(5);
  });

  it('hit fora da janela não pesa na contagem', async () => {
    await plantarFalhaAntiga(BALDE, 3600); // 1h atrás, janela é 15min
    const estado = await throttle.registrarEContar(BALDE);

    expect(estado.falhas).toBe(1);
  });

  it('a janela drena: com as falhas antigas fora, volta a liberar', async () => {
    for (let i = 0; i < 5; i++) await plantarFalhaAntiga(BALDE, 3600);
    const estado = await throttle.registrarEContar(BALDE);

    expect(estado.falhas).toBe(1);
    expect(estado.bloqueadoAte).toBeNull();
  });

  it('escala pelos degraus conforme as falhas se acumulam', async () => {
    // Planta 7 falhas recentes sem passar pelo portão (que bloquearia na
    // quinta) e confere o degrau da oitava.
    for (let i = 0; i < 7; i++) await plantarFalhaAntiga(BALDE, 1);
    const estado = await throttle.consultar(BALDE);

    expect(estado.falhas).toBe(7);
    // 7 falhas → degrau de 5 (30s), não o de 8 (300s).
    const restante = estado.bloqueadoAte!.getTime() - Date.now();
    expect(restante).toBeLessThanOrEqual(30_000);
  });

  it('baldes diferentes não se contaminam', async () => {
    await falharVezes('email:um', 6);
    const outro = await throttle.registrarEContar('email:dois');

    expect(outro.falhas).toBe(1);
    expect(outro.bloqueadoAte).toBeNull();
  });

  it('limpar zera o balde', async () => {
    await falharVezes(BALDE, 6);
    await throttle.limpar(BALDE);

    expect((await throttle.consultar(BALDE)).falhas).toBe(0);
  });

  it('consultar não registra nada', async () => {
    await throttle.consultar(BALDE);
    await throttle.consultar(BALDE);

    expect((await throttle.consultar(BALDE)).falhas).toBe(0);
  });

  it('tentativas concorrentes são todas contadas', async () => {
    // INSERT, não read-modify-write num contador: não há lost update. A CTE
    // existe para a CONTAGEM não ser lida antes da escrita da outra, e é isso
    // que este teste exercita.
    await Promise.all(
      Array.from({ length: 4 }, () => throttle.registrarEContar(BALDE)),
    );

    expect((await throttle.consultar(BALDE)).falhas).toBe(4);
  });
});
