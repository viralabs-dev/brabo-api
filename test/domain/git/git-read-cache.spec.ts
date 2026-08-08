import { describe, expect, it } from 'vitest';
import { GitReadCache } from '../../../src/domain/git/git-read-cache';

/**
 * O cache existe para o teto (item 34 da FASE 26): sem ele, navegar a árvore e
 * buscar repetem as MESMAS chamadas ao provider, e cada repetição gasta a
 * credencial do owner do workspace.
 *
 * O relógio é injetado porque testar TTL com `sleep` faz suite lenta e
 * intermitente — e uma suite intermitente é pior que uma que não testa TTL.
 */
describe('GitReadCache', () => {
  const relogio = (t: { agora: number }) => () => t.agora;

  it('caminho feliz: o que entrou sai, e não sai o que não entrou', () => {
    const cache = new GitReadCache(10, 1000, relogio({ agora: 0 }));
    cache.set('a', { entries: [] });
    expect(cache.get('a')).toEqual({ entries: [] });
    expect(cache.get('b')).toBeUndefined();
  });

  it('guarda `null` sem confundir com ausente — o caso do arquivo inexistente', () => {
    // `getFileContent` devolve `null` para arquivo que não existe, e é
    // justamente esse o resultado que mais se repete numa busca. Se `null`
    // fosse indistinguível de "não cacheado", a ausência custaria uma chamada
    // ao provider toda vez.
    const cache = new GitReadCache(10, 1000, relogio({ agora: 0 }));
    cache.set('vazio', null);
    expect(cache.get('vazio')).toBeNull();
    expect(cache.get('nunca-visto')).toBeUndefined();
  });

  it('caso de falha: passado o TTL, a entrada some e o chamador relê', () => {
    const t = { agora: 0 };
    const cache = new GitReadCache(10, 1000, relogio(t));
    cache.set('a', 'conteúdo antigo');

    t.agora = 999;
    expect(cache.get('a')).toBe('conteúdo antigo');

    t.agora = 1000;
    expect(cache.get('a')).toBeUndefined();
    // Expirar também LIBERA: senão o teto de entradas seria consumido por
    // lixo e o cache pararia de cachear o que importa.
    expect(cache.tamanho).toBe(0);
  });

  it('o teto de entradas descarta a menos usada, não a mais antiga', () => {
    const cache = new GitReadCache(2, 1000, relogio({ agora: 0 }));
    cache.set('a', 1);
    cache.set('b', 2);
    // Ler `a` a torna a mais recente. Sem isso, o diretório que a busca visita
    // a cada varredura seria o primeiro a cair.
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.tamanho).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
