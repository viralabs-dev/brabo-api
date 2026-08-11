import {
  GIT_READ_CACHE_MAX_ENTRIES,
  GIT_READ_CACHE_TTL_MS,
} from './git-read-limits';

/**
 * Cache de leitura da aba Code (FASE 26b, item 34 — "teto e cache").
 *
 * ## Por que existe
 *
 * As leituras da aba se repetem por natureza: navegar a árvore volta ao mesmo
 * diretório, e a busca abre `listTree` no mesmo lugar que o navegador acabou de
 * abrir. Sem cache, cada uma dessas repetições é uma chamada nova ao provider —
 * com a credencial do owner do workspace pagando por ela (RN-058/RN-082) e o
 * rate limit do GitHub contando.
 *
 * ## Por que TTL curto e não invalidação
 *
 * A aba lê uma branch VIVA. Invalidar de verdade exigiria saber quando o
 * repositório mudou, e o produto não tem esse sinal para push feito fora dele.
 * Um TTL curto (`GIT_READ_CACHE_TTL_MS`) é honesto sobre isso: a tela pode
 * mostrar até 30s de atraso, e nunca mais que isso. TTL longo mostraria código
 * que não existe mais, o que numa aba de LEITURA de código é pior que uma
 * chamada extra.
 *
 * ## Por que os limites são de tamanho, não só de tempo
 *
 * Um cache só por tempo cresce sem teto sob carga: mil caminhos distintos em
 * 30s são mil entradas vivas, com conteúdo de arquivo dentro. O teto de
 * entradas transforma isso em memória constante.
 *
 * ## Sobre autorização
 *
 * A chave NÃO tem usuário, e isso é deliberado: quem chega aqui já passou pelo
 * `role:viewer` do projeto na rota, e a chave carrega provider + repositório +
 * ref + caminho. Duas pessoas com acesso ao mesmo projeto veem o mesmo
 * repositório, então compartilhar a entrada não vaza nada que uma delas não
 * pudesse pedir sozinha. Se um dia a leitura passar a depender de QUEM lê, a
 * chave tem de ganhar essa dimensão — está escrito aqui porque é o tipo de
 * premissa que some.
 *
 * Puro e sem timer: a expiração é conferida na LEITURA. Um `setInterval` de
 * limpeza seguraria o processo vivo no shutdown gracioso (ADR 0026) para varrer
 * cache, que é exatamente o que aquele desenho evita.
 */
export class GitReadCache {
  private readonly entradas = new Map<
    string,
    { valor: unknown; expiraEm: number }
  >();

  constructor(
    private readonly maxEntradas: number = GIT_READ_CACHE_MAX_ENTRIES,
    private readonly ttlMs: number = GIT_READ_CACHE_TTL_MS,
    /** Injetável para o teste não depender do relógio de parede. */
    private readonly agora: () => number = () => Date.now(),
  ) {}

  /** `undefined` tanto para ausente quanto para expirado — o chamador relê. */
  get<T>(chave: string): T | undefined {
    const entrada = this.entradas.get(chave);
    if (!entrada) return undefined;
    if (entrada.expiraEm <= this.agora()) {
      this.entradas.delete(chave);
      return undefined;
    }
    // Reinsere para virar a mais recente: o descarte abaixo é por ordem de
    // uso, não de escrita. Sem isto, o diretório que a busca visita a cada
    // varredura seria o primeiro a ser descartado.
    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    return entrada.valor as T;
  }

  set(chave: string, valor: unknown): void {
    this.entradas.delete(chave);
    this.entradas.set(chave, { valor, expiraEm: this.agora() + this.ttlMs });
    while (this.entradas.size > this.maxEntradas) {
      const maisAntiga = this.entradas.keys().next();
      if (maisAntiga.done) break;
      this.entradas.delete(maisAntiga.value);
    }
  }

  /** Só para teste e diagnóstico — o produto nunca precisa saber o tamanho. */
  get tamanho(): number {
    return this.entradas.size;
  }
}
