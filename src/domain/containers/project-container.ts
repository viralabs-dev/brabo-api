/**
 * O container do projeto como DECISÃO do Arquiteto (ADR 0065).
 *
 * Puro, sem IO: aqui mora só o que é verdade sobre uma decisão de imagem
 * válida. Quem grava o artefato é o caso de uso; quem o lê de volta é o
 * event log.
 *
 * ## Por que a imagem é artefato, e não configuração
 *
 * A imagem decide o que o agente consegue fazer dentro do container — qual
 * runtime existe, qual gerenciador de pacotes, qual compilador. Isso é
 * decisão de ARQUITETURA, do mesmo calibre do `module_map` e dos ADRs que o
 * Arquiteto já emite, e por isso nasce versionada e auditável no event log em
 * vez de virar uma variável de ambiente que ninguém sabe quem mudou.
 *
 * ## Por que tag explícita, e nunca `latest`
 *
 * Um artefato que diz `node:latest` não descreve nada: o container que subiu
 * em março e o que sobe hoje são imagens diferentes com o mesmo nome, e a
 * auditoria passa a mentir. Exigir tag ou digest é o que faz a decisão do
 * Arquiteto continuar significando a mesma coisa quando alguém a lê meses
 * depois.
 */

/**
 * Postura de rede do container.
 *
 * NÃO é decidida comando a comando, e essa é a decisão central do ADR 0065.
 * Os achados Z e AD provaram que allowlist de verbo não converge — verbo,
 * forma e invocação são espaços distintos, e `curl`, `npm install` e
 * `python -c "urllib..."` são o mesmo egresso escrito de três maneiras. A
 * saída não é um allowlist melhor: é decidir UMA vez, na fronteira que o
 * kernel entende, e deixar o agente livre dentro dela.
 *
 * - `none` — o container não alcança a rede. Default, e é o que torna
 *   "dentro o agente é livre" uma frase segura: livre num lugar sem saída.
 * - `egress` — o container sai para a internet. É gasto e é superfície: o
 *   Arquiteto pode pedir (uma stack que baixa dependências não funciona sem
 *   isso), mas quem autoriza é o usuário, no provisionamento.
 */
export type PosturaDeRede = 'none' | 'egress';

export const POSTURAS_DE_REDE: readonly PosturaDeRede[] = ['none', 'egress'];

/**
 * Teto de recursos do container. Gasto merece veredito próprio: um container
 * sem teto é um jeito silencioso de o produto consumir a máquina inteira, e a
 * lição da FASE 14d é que quem decide quanto se gasta é o usuário.
 */
export interface RecursosDoContainer {
  /** CPUs (fração permitida, ex.: 1.5). */
  cpus: number;
  /** Memória em MiB. */
  memoryMb: number;
  /** Teto de processos — o que contém fork bomb sem depender de allowlist. */
  pidsLimit: number;
}

export const RECURSOS_PADRAO: RecursosDoContainer = {
  cpus: 2,
  memoryMb: 4096,
  pidsLimit: 512,
};

/**
 * Teto duro. O Arquiteto propõe recursos; acima disto a proposta é recusada em
 * vez de silenciosamente rebaixada — rebaixar em silêncio faria o artefato
 * dizer uma coisa e o container ser outra, que é exatamente o defeito que a
 * versão auditável existe para não ter.
 */
export const RECURSOS_MAXIMOS: RecursosDoContainer = {
  cpus: 8,
  memoryMb: 16384,
  pidsLimit: 4096,
};

export interface DecisaoDeImagem {
  /** Referência completa da imagem, com tag ou digest. */
  image: string;
  /** Por que ESTA imagem. É o que torna a decisão revisável. */
  rationale: string;
  network: PosturaDeRede;
  resources: RecursosDoContainer;
}

export class ImagemInvalidaError extends Error {}

/**
 * Referência de imagem OCI, no que importa para nós.
 *
 * Não reimplementa a gramática do distribution spec — só recusa o que faria a
 * referência deixar de ser uma referência: espaço em branco, metacaractere de
 * shell (a referência vira argumento de um comando de runtime lá na frente) e
 * ausência de tag/digest.
 *
 * Sem regex com quantificador aninhado, pela mesma razão do `semBarraFinal` em
 * `path-scope.ts`: o valor vem de um modelo de linguagem, e um `js/polynomial-
 * redos` aqui seria a mesma HIGH do CodeQL com outro nome.
 */
const METACARACTERES = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  ';',
  '&',
  '|',
  '$',
  '`',
  '(',
  ')',
  '<',
  '>',
  '"',
  "'",
  '\\',
  '*',
  '?',
  '!',
  '#',
]);

export function referenciaDeImagemValida(ref: string): boolean {
  if (ref.length === 0 || ref.length > 512) return false;
  for (const c of ref) if (METACARACTERES.has(c)) return false;
  return temTagOuDigest(ref);
}

/**
 * A tag vem depois do ÚLTIMO `:`, e só é tag se não houver `/` depois dela —
 * `registry.local:5000/app` tem dois-pontos de PORTA, não de tag, e tratá-lo
 * como tag deixaria passar uma referência sem versão nenhuma.
 */
function temTagOuDigest(ref: string): boolean {
  const digest = ref.indexOf('@sha256:');
  if (digest > 0) return ref.length > digest + '@sha256:'.length;

  const doisPontos = ref.lastIndexOf(':');
  if (doisPontos <= 0) return false;
  const depois = ref.slice(doisPontos + 1);
  if (depois.length === 0 || depois.includes('/')) return false;

  // `latest` é o mesmo que não ter tag: o nome não determina a imagem.
  return depois !== 'latest';
}

export interface DecisaoDeImagemInput {
  image?: unknown;
  rationale?: unknown;
  network?: unknown;
  resources?: unknown;
}

/**
 * Valida e normaliza. Lança `ImagemInvalidaError` com a mensagem que volta ao
 * modelo pelo tool-result (RN-061): ele lê o que estava errado e corrige, em
 * vez de tentar de novo igual.
 */
export function validarDecisaoDeImagem(
  input: DecisaoDeImagemInput,
): DecisaoDeImagem {
  const image = typeof input.image === 'string' ? input.image.trim() : '';
  if (!referenciaDeImagemValida(image)) {
    throw new ImagemInvalidaError(
      `Imagem inválida: "${image}". Use uma referência OCI com TAG explícita ` +
        `ou digest (ex.: "node:22-bookworm-slim", "python:3.12-slim"). ` +
        `"latest" não é aceito: o artefato precisa dizer a mesma coisa daqui a ` +
        `seis meses.`,
    );
  }

  const rationale =
    typeof input.rationale === 'string' ? input.rationale.trim() : '';
  if (rationale.length < 10) {
    throw new ImagemInvalidaError(
      'A decisão precisa de `rationale`: POR QUE esta imagem para este projeto ' +
        '(pelo menos 10 caracteres). Sem o porquê, o artefato não é revisável.',
    );
  }

  const network = input.network ?? 'none';
  if (!POSTURAS_DE_REDE.includes(network as PosturaDeRede)) {
    throw new ImagemInvalidaError(
      `network inválida: "${descreverValor(network)}". Use "none" (default) ou ` +
        `"egress" — e "egress" só quando a stack de fato precisa baixar coisas, ` +
        `porque é o usuário que autoriza a saída para a internet.`,
    );
  }

  return {
    image,
    rationale,
    network: network as PosturaDeRede,
    resources: validarRecursos(input.resources),
  };
}

/**
 * Descreve um valor `unknown` para MENSAGEM de erro, sem o `no-base-to-string`
 * do `String(objeto)` — que produziria `[object Object]` e esconderia
 * justamente o que o modelo mandou de errado.
 */
function descreverValor(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor === null || valor === undefined) return String(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return '(valor não serializável)';
  }
}

function validarRecursos(entrada: unknown): RecursosDoContainer {
  const bruto = (entrada ?? {}) as Record<string, unknown>;

  return {
    cpus: numeroNoTeto(bruto.cpus, 'cpus'),
    memoryMb: numeroNoTeto(bruto.memoryMb, 'memoryMb'),
    pidsLimit: numeroNoTeto(bruto.pidsLimit, 'pidsLimit'),
  };
}

function numeroNoTeto(
  valor: unknown,
  campo: keyof RecursosDoContainer,
): number {
  if (valor === undefined || valor === null) return RECURSOS_PADRAO[campo];

  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ImagemInvalidaError(
      `resources.${campo} precisa ser um número positivo (recebi ${descreverValor(valor)}).`,
    );
  }
  if (n > RECURSOS_MAXIMOS[campo]) {
    throw new ImagemInvalidaError(
      `resources.${campo} = ${n} passa do teto de ${RECURSOS_MAXIMOS[campo]}. ` +
        `O teto não rebaixa em silêncio: um artefato que promete mais do que o ` +
        `container recebe mente para quem o audita.`,
    );
  }
  return n;
}

/** Tipo do evento que É o artefato. Não há tabela: o event log é o registro. */
export const EVENTO_IMAGEM_DO_PROJETO = 'artifact.project_image';

/**
 * O estado do container de um projeto, do ponto de vista de quem pergunta
 * "já dá para liberar o Code?".
 *
 * `sem_decisao` é o estado INICIAL de todo projeto, e é ele que fecha o
 * portão: enquanto o Arquiteto não decidir, não há imagem, não há container e
 * a superfície de código não abre (RN-105).
 */
export interface EstadoDoContainer {
  status: 'sem_decisao' | 'decidido';
  decisao: DecisaoDeImagem | null;
  /** Versão do artefato vigente — 0 quando não há decisão. */
  version: number;
  /** Id do evento que fixou a decisão vigente, para auditoria. */
  eventId: string | null;
  decidedAt: string | null;
}

export const SEM_DECISAO: EstadoDoContainer = {
  status: 'sem_decisao',
  decisao: null,
  version: 0,
  eventId: null,
  decidedAt: null,
};

/**
 * A versão declarada no payload de um evento `artifact.project_image` — 1
 * quando ausente/inválida (schema mais antigo, de antes de `version`
 * existir). Extraída de `ObterContainerDoProjetoUseCase` para ser reusada por
 * quem precisa achar uma versão ESPECÍFICA entre vários eventos, não só a
 * vigente (ver `decisaoNaVersao`, abaixo).
 */
export function versaoDoPayload(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/**
 * A decisão de imagem gravada numa VERSÃO específica, entre uma lista de
 * eventos `artifact.project_image` de um projeto — `null` quando essa versão
 * não está entre os eventos lidos (nunca inventa).
 *
 * Diferente da leitura VIGENTE que `ObterContainerDoProjetoUseCase` faz (a de
 * maior versão): quem grava `project_containers.image_version` CONGELA a
 * versão vigente no instante em que a linha nasceu (RN-105/245), e o
 * Arquiteto pode ter revisado a decisão DEPOIS — a leitura vigente mostraria
 * uma imagem que não é a que o container congelado usa. A página de
 * containers (ADR 0136) precisa da imagem QUE FOI CONGELADA, não da mais
 * recente.
 *
 * Mesmo degrade de `ObterContainerDoProjetoUseCase` para um payload que não
 * valida mais: a referência de imagem crua sobrevive, o resto vira default —
 * nunca derruba a leitura por um schema antigo.
 */
export function decisaoNaVersao(
  eventos: { payload: unknown }[],
  version: number,
): DecisaoDeImagem | null {
  const evento = eventos.find((e) => versaoDoPayload(e.payload) === version);
  if (!evento) return null;

  const payload = (evento.payload ?? {}) as Record<string, unknown>;
  try {
    return validarDecisaoDeImagem(payload);
  } catch {
    return {
      image: typeof payload.image === 'string' ? payload.image : '(ilegível)',
      rationale: typeof payload.rationale === 'string' ? payload.rationale : '',
      network: 'none' as const,
      resources: RECURSOS_PADRAO,
    };
  }
}
