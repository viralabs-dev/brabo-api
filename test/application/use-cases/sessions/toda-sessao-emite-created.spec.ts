import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nenhum caminho cria sessão pelo repositório (RN-067).
 *
 * `CreateSessionUseCase` é o único lugar que emite `session.created` no outbox,
 * e é esse evento que faz o engine subir o SessionServer da sessão. Quem chama
 * `sessions.create(...)` direto produz uma sessão que o engine nunca conhece:
 * o canal responde `REFUSED JOIN` para sempre, o chat não atualiza ao vivo,
 * ninguém bate heartbeat — e, como o heartbeat é justamente o que a encerra,
 * ela fica `active` eternamente.
 *
 * Três caminhos faziam isso, e o defeito só apareceu numa execução real:
 * `provision-repository` (2×), `adopt-repository` e `activate-execution` — este
 * último cria a sessão em que os DEV AGENTS rodam.
 *
 * O teste é sobre a FONTE de propósito. Um teste de comportamento provaria um
 * caminho de cada vez, e o defeito aqui é justamente o caminho em que ninguém
 * pensou. O que se afirma é que não existe escapatória.
 */

const RAIZ = join(__dirname, '../../../../src/application/use-cases');

/** O único arquivo autorizado a chamar `sessions.create`. */
const DONO = 'sessions/create-session.use-case.ts';

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return caminho.endsWith('.ts') ? [caminho] : [];
  });
}

describe('RN-067 — toda sessão nasce emitindo `session.created`', () => {
  it('só o CreateSessionUseCase chama `sessions.create`', () => {
    // `this.sessions.create(` e variações de nome do campo injetado.
    const chamada = /this\.\w*[Ss]essions?\w*\.create\(/;

    const infratores = arquivosTs(RAIZ)
      .filter((caminho) => !caminho.endsWith(DONO))
      .filter((caminho) => chamada.test(readFileSync(caminho, 'utf-8')))
      .map((caminho) => caminho.slice(RAIZ.length + 1));

    expect(infratores).toEqual([]);
  });

  it('o CreateSessionUseCase emite o evento junto do insert', () => {
    // O par é o ponto: criar sem emitir, ou emitir fora da transação, devolve
    // o mesmo defeito por outro caminho.
    const fonte = readFileSync(join(RAIZ, DONO), 'utf-8');

    const transacao = fonte.indexOf('runInTransaction');
    const insert = fonte.indexOf('sessions.create(');
    const evento = fonte.indexOf("eventType: 'session.created'");

    expect(transacao).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(evento).toBeGreaterThan(-1);

    // Os dois DEPOIS da abertura da transação, o insert antes do append: é
    // essa ordem que faz o par ser atômico.
    expect(insert).toBeGreaterThan(transacao);
    expect(evento).toBeGreaterThan(insert);
  });
});
