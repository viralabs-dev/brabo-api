/**
 * Trava de tipo entre um DTO de resposta e a entidade que ele espelha
 * (Fase 7b, item 6).
 *
 * ## O problema que isto resolve
 *
 * Escrever o DTO é o fácil. O risco é o dia em que a entidade de domínio ganha
 * um campo, o DTO não, e a referência gerada passa a mentir **em silêncio** —
 * nenhum teste falha, porque nada relaciona os dois. Uma doc que mente é pior
 * que doc nenhuma: quem lê deixa de conferir no código.
 *
 * ## Por que `implements Session` direto não serve
 *
 * A entidade diz `createdAt: Date`; o corpo JSON diz `createdAt: string` (o
 * `apps/web/src/lib/api-types.ts` já trata como string, porque é o que chega).
 * Um `implements Session` obrigaria o DTO a declarar `Date` para compilar — ou
 * seja, a mentir exatamente sobre o que ele existe para descrever.
 *
 * `Wire<T>` é a entidade **como ela sai no fio**: `Date` vira `string`, e a
 * recursão preserva o resto. Aí `implements Wire<Session>` é honesto.
 *
 * ## Por que as DUAS travas
 *
 * `implements` é unidirecional: pega campo que falta e tipo errado, mas é
 * **cego a campo sobrando**. Um DTO que descreve um campo que a entidade já
 * removeu continua compilando para sempre. `MesmasChaves` fecha esse lado.
 *
 * | erro | pego por |
 * |---|---|
 * | entidade ganhou campo, DTO não | `implements` — TS2420 |
 * | DTO declara `Date` onde o fio tem `string` | `implements` — TS2416 |
 * | DTO tem campo que a entidade não tem mais | `MesmasChaves` — TS2322 |
 *
 * Quem executa as duas é o `tsc`, não o vitest: o vitest transpila por SWC e
 * apaga os tipos sem verificá-los. Daí o `pnpm --filter api typecheck` no CI.
 */

/**
 * A entidade como ela atravessa o JSON.
 *
 * O parâmetro é "nu" no condicional de propósito: assim ele DISTRIBUI sobre
 * união, e `Date | null` vira `string | null` em vez de colapsar.
 */
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : // `unknown` (payload de evento) e primitivos passam intactos; só objeto
      // de forma conhecida é percorrido.
      T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

/**
 * `true` se os dois tipos têm exatamente o mesmo conjunto de chaves, `never`
 * caso contrário — e atribuir `true` a `never` é erro de compilação.
 *
 * Os colchetes em `[keyof A] extends [keyof B]` desligam a distribuição: sem
 * eles a comparação seria feita chave a chave e passaria com qualquer
 * sobreposição parcial.
 */
export type MesmasChaves<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
