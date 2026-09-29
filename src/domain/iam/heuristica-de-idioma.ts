/**
 * A heurística de idioma da AT-080 ("A — heurística própria, sem dependência"),
 * medida pelo instrumento da AT-160 e rodando no PRODUTO desde a AT-163
 * (RN-624): é daqui que `DetectarIdiomaDoAutorUseCase` classifica as mensagens
 * do autor, e é ESTE arquivo que `scripts/idioma/` mede (ele o reexporta) —
 * uma régua só, nunca uma cópia no instrumento e outra no produto.
 *
 * Por que mora na api e o instrumento importa daqui, e não o contrário: a api
 * não alcança `scripts/` (nem no build, nem na imagem), `packages/shared` é
 * 100% tipo, e um pacote de runtime novo exigiria passo de build só para isto.
 * O preço é uma restrição que este arquivo carrega: **nenhum `import`** e só
 * sintaxe apagável, porque o Node o executa a partir de `scripts/` por type
 * stripping (detectando a sintaxe de módulo, já que `apps/api` não declara
 * `"type"`) — e o typecheck de `scripts/idioma/` (com `erasableSyntaxOnly`) o
 * cobra, num tsconfig próprio sem `verbatimModuleSyntax`, que recusaria os
 * `export` de um módulo CommonJS.
 *
 * O desenho é o da especificação, sem invenção:
 *   - três línguas (`pt`, `es`, `en`) mais `indeterminado`;
 *   - pontuação por MARCADORES CONTRASTIVOS — palavras e grafias que uma língua
 *     tem e a outra não; as compartilhadas por pt e es (`está`, `para`, `como`,
 *     `que`) NÃO pontuam, porque são justamente as que produzem a confusão;
 *   - LIMPEZA antes de contar (código, log, citação, URL, identificador);
 *   - parâmetros candidatos: amostra de 10 mensagens / 2.000 caracteres,
 *     evidência mínima de 20 palavras, limiar 0,8, margem 0,3, histerese 2.
 *
 * Há DUAS listas de marcadores. `AT080` é a da especificação, literal. `AMPLIADA`
 * é uma proposta do instrumento, escrita antes de rodar contra o corpus (a
 * partir de palavras funcionais frequentes, não do corpus) — existe porque a
 * lista da AT-080 tem sete palavras de inglês e sete de português, e medir só
 * ela diria apenas "sete palavras não bastam". O produto usa a `AT080`
 * (`PARAMETROS_PROVISORIOS` abaixo diz por quê).
 */

export type Idioma = 'pt' | 'es' | 'en';
export type Veredito = Idioma | 'indeterminado';

export const IDIOMAS: readonly Idioma[] = ['pt', 'es', 'en'];

export interface Marcadores {
  nome: string;
  /** Palavras inteiras (minúsculas) que pontuam para a língua. */
  palavras: Record<Idioma, readonly string[]>;
  /** Terminações que pontuam (o token inteiro, minúsculo, termina assim). */
  sufixos: Record<Idioma, readonly string[]>;
  /** Sequências de letras que, contidas no token, pontuam. */
  grafias: Record<Idioma, readonly string[]>;
  /** Sinais de pontuação que pontuam a cada ocorrência (`¿`, `¡`). */
  sinais: Record<Idioma, readonly string[]>;
}

/** A lista da AT-080, literal ("Mecanismo candidato"). */
// prettier-ignore
export const AT080: Marcadores = {
  nome: 'at080',
  palavras: {
    pt: ['você', 'não', 'também', 'então', 'isso', 'obrigado', 'pra'],
    es: ['usted', 'muy', 'pero', 'hola', 'gracias', 'qué', 'cómo', 'también', 'entonces', 'ahora'],
    en: ['the', 'and', 'is', 'you', 'what', 'this', 'with'],
  },
  sufixos: { pt: ['ção', 'ções'], es: ['ción', 'ciones'], en: [] },
  grafias: { pt: ['ã', 'õ', 'ê'], es: ['ñ'], en: [] },
  sinais: { pt: [], es: ['¿', '¡'], en: [] },
};

/**
 * Proposta deste instrumento. Critério de entrada de cada palavra: é frequente
 * na língua e NÃO existe (ou é raríssima) como palavra nas outras duas — com a
 * grafia sem acento incluída quando é assim que as pessoas digitam (`nao`,
 * `voce`). Ficaram de fora de propósito, por existirem nas duas ibéricas:
 * `está`, `para`, `como`, `que`, `por`, `no`, `tu`, `me`, `desde`, `todo`,
 * `nada`, `porque`, `mas`/`más`, `vamos`, `esta`; e `do`, que é
 * português e também inglês.
 */
// prettier-ignore
export const AMPLIADA: Marcadores = {
  nome: 'ampliada',
  palavras: {
    pt: [
      ...AT080.palavras.pt,
      'vocês', 'voce', 'vc', 'vcs', 'nao', 'tbm', 'entao', 'obrigada', 'pro', 'isto', 'aquilo',
      'dos', 'das', 'ao', 'aos', 'às', 'um', 'uma', 'umas', 'uns', 'em', 'num', 'numa',
      'pelo', 'pela', 'pelos', 'pelas', 'nesse', 'nessa', 'neste', 'nesta', 'desse', 'dessa',
      'esse', 'essa', 'esses', 'essas', 'eu', 'ele', 'ela', 'eles', 'elas', 'nós', 'meu', 'minha',
      'seu', 'sua', 'dele', 'dela', 'muito', 'muita', 'muitos', 'tem', 'têm', 'tenho', 'agora',
      'depois', 'ainda', 'já', 'só', 'sim', 'oq', 'pq', 'tá', 'aqui', 'onde', 'quando', 'qual',
      'quais', 'com', 'sem', 'até', 'fazer', 'faz', 'fica', 'precisa', 'preciso', 'consegue',
      'consigo', 'pode', 'posso', 'deu', 'valeu', 'beleza', 'tudo', 'coisa', 'errado', 'certo',
      'obg', 'gente', 'rodar', 'roda', 'olha', 'vou', 'foi', 'ficou', 'deve',
    ],
    es: [
      ...AT080.palavras.es,
      'ustedes', 'el', 'los', 'las', 'y', 'del', 'al', 'es', 'un', 'una', 'yo', 'tú', 'él', 'ella',
      'ellos', 'nosotros', 'puedes', 'puede', 'puedo', 'hay', 'estoy', 'eso', 'esto',
      'aquí', 'donde', 'dónde', 'cuando', 'cuándo', 'cual', 'cuál', 'hacer', 'hace', 'tengo',
      'tiene', 'tienes', 'necesito', 'quiero', 'bien', 'sí', 'con', 'sin', 'hasta', 'ya', 'lo',
      'le', 'les', 'mucho', 'mucha', 'ahí', 'allí', 'porqué', 'también', 'mi', 'su', 'sus',
      'algo', 'nuevo', 'nueva', 'luego', 'debe', 'fue', 'voy', 'mira',
      'gracias', 'oye', 'vale',
    ],
    en: [
      ...AT080.palavras.en,
      'are', 'was', 'were', 'be', 'been', 'it', 'its', "it's", 'of', 'to', 'in', 'for', 'that',
      'not', 'have', 'has', 'can', 'does', 'why', 'how', 'please', 'i', 'my', 'we', 'they',
      'there', 'from', 'but', 'if', 'on', 'should', 'would', 'could', 'will', 'just', 'your',
      'which', 'when', 'where', 'about', 'into', 'than', 'then', "don't", "doesn't", "can't",
      'thanks', 'an', 'our', 'these', 'those', 'still', 'after', 'before', 'now', 'here', 'fix',
    ],
  },
  sufixos: {
    pt: [...AT080.sufixos.pt, 'ão', 'agem'],
    es: [...AT080.sufixos.es, 'dad', 'aje'],
    en: [],
  },
  // Nenhuma grafia nem sufixo de inglês (`th`, `w`, `-ing`, `-tion`): os
  // empréstimos técnicos que o pt-BR usa todo dia (`workflow`, `method`,
  // `logging`, `function`) pontuariam inglês numa frase portuguesa — o caso
  // difícil que a AT-080 nomeia. Inglês pontua só por palavra funcional.
  grafias: { pt: [...AT080.grafias.pt, 'nh', 'lh', 'ç'], es: [...AT080.grafias.es], en: [] },
  sinais: { pt: [], es: ['¿', '¡'], en: [] },
};

export const VARIANTES: Record<string, Marcadores> = {
  at080: AT080,
  ampliada: AMPLIADA,
};

export interface Parametros {
  /** Evidência mínima: palavras úteis na amostra depois da limpeza. */
  minPalavras: number;
  /** Fração mínima da pontuação total para a vencedora. */
  limiar: number;
  /** Diferença mínima de fração entre a vencedora e a segunda. */
  margem: number;
  /** Tamanho da amostra: as N últimas mensagens do usuário. */
  janelaMensagens: number;
  /** Teto da amostra em caracteres, depois da limpeza (mantém as mais recentes). */
  janelaCaracteres: number;
  /** Avaliações seguidas concordando com o idioma novo antes de trocar. */
  histerese: number;
  /** Trecho entre aspas com mais que isto de palavras é tratado como citação. */
  palavrasDeCitacao: number;
}

/** Os candidatos da AT-080, literais. */
export const PARAMETROS_AT080: Parametros = {
  minPalavras: 20,
  limiar: 0.8,
  margem: 0.3,
  janelaMensagens: 10,
  janelaCaracteres: 2000,
  histerese: 2,
  palavrasDeCitacao: 4,
};

/**
 * Os parâmetros que o PRODUTO usa (AT-163, RN-624) — **PROVISÓRIOS**. Saíram
 * do corpus SINTÉTICO da AT-160, que foi escrito pela mesma mão que escreveu a
 * heurística; o dono os recalibra com o corpus REAL
 * (`pnpm --filter @brabo/scripts idioma:medir --real`), e trocar um número é
 * mudar ESTE objeto, que é o único lugar de onde a api os lê.
 *
 * O que difere dos candidatos da AT-080, e por quê (números da varredura em
 * `docs/explanation/medicao-do-idioma.md`, lista `at080`):
 *   - `minPalavras` 10 e não 20: a 20 a cobertura dos decidíveis é 42,2%, a
 *     10 é 58,9%, e os erros de língua são OS MESMOS três nas duas (francês,
 *     galego e holandês, línguas fora das três) — nenhum sobre pt/es/en, misto
 *     ou "ok". Abaixo de 10 o texto misto passa a decidir.
 *   - lista `AT080` e não `AMPLIADA`: a ampliada ganha 4 pontos em pt e erra
 *     alemão duas vezes; nenhuma das duas foi validada por dado real.
 *   - limiar 0,8 e margem 0,3 ficam: no sintético eles NUNCA agem (66 de 67
 *     itens que pontuam pontuam uma língua só), então não há número melhor a
 *     escolher — só o corpus real pode mostrar se agem.
 */
export const PARAMETROS_PROVISORIOS: Parametros = {
  ...PARAMETROS_AT080,
  minPalavras: 10,
};

// ------------------------------------------------------------------ limpeza

const CERCA = /```[\s\S]*?(```|$)/g;
const CRASE_SIMPLES = /`[^`\n]*`/g;
const URL = /\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const ASPAS = /"([^"\n]*)"|“([^”\n]*)”|«([^»\n]*)»/g;

/** Linha com cara de log (item 2 da limpeza da AT-080). */
export function ehLinhaDeLog(linha: string): boolean {
  const l = linha.trim();
  if (l === '') return false;
  if (/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(l)) return true;
  if (/^\[?\d{2}:\d{2}:\d{2}/.test(l)) return true;
  if (/\b(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE|PANIC)\b/.test(l))
    return true;
  if (/^at\s+\S+.*[(:]/.test(l)) return true; // stack trace (JS/Java)
  if (/^File ".*", line \d+/.test(l)) return true; // stack trace (Python)
  if (/^Traceback \(most recent call last\)/.test(l)) return true;
  if (/\bexit code\b|\bexited with code\b|\bexit status \d+/i.test(l))
    return true;
  if (/^\*\*\s*\(\w+Error\)/.test(l)) return true; // Elixir: ** (RuntimeError)
  if (/^(\/|\.\/|~\/|[A-Za-z]:\\)\S+$/.test(l)) return true; // linha que é só um caminho
  if (/^[$#>]\s/.test(l) && !/^>\s/.test(l)) return true; // prompt de shell ($ ls, # apt)
  return false;
}

/** Identificador técnico: snake_case, camelCase, hash, caminho, arquivo, número. */
export function ehIdentificador(token: string): boolean {
  if (/[_/\\]/.test(token)) return true;
  if (/\p{Ll}\p{Lu}/u.test(token)) return true;
  if (/\d/.test(token)) return true;
  if (/^[0-9a-f]{7,}$/i.test(token)) return true;
  if (/\w\.\w/.test(token)) return true; // arquivo.ts, pacote.modulo
  if (/^--?\w/.test(token)) return true; // --flag
  if (/[{}()[\]<>=;$]/.test(token)) return true;
  return false;
}

export interface Limpeza {
  texto: string;
  /** Palavras (tokens de letras) que sobraram. */
  palavras: string[];
  /** Palavras que existiam antes da limpeza. */
  palavrasAntes: number;
}

function palavrasDe(texto: string): string[] {
  return texto.toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? [];
}

/**
 * Tira da evidência o que não é prosa do usuário (itens 1–4 da AT-080). O item
 * 5 (rótulo do formulário) e o 6 (mensagem do agente) são da EXTRAÇÃO: esses
 * textos nem chegam aqui.
 */
export function limpar(
  texto: string,
  p: Pick<Parametros, 'palavrasDeCitacao'> = PARAMETROS_AT080,
): Limpeza {
  const palavrasAntes = palavrasDe(texto).length;
  let t = texto.replace(CERCA, ' ').replace(CRASE_SIMPLES, ' ');
  t = t.replace(URL, ' ').replace(EMAIL, ' ');
  t = t.replace(ASPAS, (inteiro, a?: string, b?: string, c?: string) => {
    const dentro = a ?? b ?? c ?? '';
    return palavrasDe(dentro).length > p.palavrasDeCitacao ? ' ' : inteiro;
  });
  const linhas = t
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))
    .filter((l) => !ehLinhaDeLog(l));
  const tokens = linhas
    .join('\n')
    .split(/\s+/)
    .filter(
      (tok) =>
        tok !== '' &&
        !ehIdentificador(tok.replace(/^[^\p{L}\d_/\\.-]+|[^\p{L}\d_]+$/gu, '')),
    );
  const limpo = tokens.join(' ');
  return { texto: limpo, palavras: palavrasDe(limpo), palavrasAntes };
}

// --------------------------------------------------------------- pontuação

export type Pontos = Record<Idioma, number>;

export function pontuar(limpeza: Limpeza, m: Marcadores): Pontos {
  const pontos: Pontos = { pt: 0, es: 0, en: 0 };
  const conjuntos = Object.fromEntries(
    IDIOMAS.map((i) => [i, new Set(m.palavras[i])]),
  ) as Record<Idioma, Set<string>>;
  for (const palavra of limpeza.palavras) {
    for (const i of IDIOMAS) {
      // Um token pontua NO MÁXIMO um ponto por língua: "não" está na lista E
      // tem "ã", e contar duas vezes premiaria a palavra, não a língua.
      if (
        conjuntos[i].has(palavra) ||
        m.sufixos[i].some(
          (s) => palavra.length > s.length + 1 && palavra.endsWith(s),
        ) ||
        m.grafias[i].some((g) => palavra.includes(g))
      ) {
        pontos[i] += 1;
      }
    }
  }
  for (const i of IDIOMAS) {
    for (const sinal of m.sinais[i])
      pontos[i] += limpeza.texto.split(sinal).length - 1;
  }
  return pontos;
}

export type Motivo =
  | 'decidido'
  | 'evidencia-insuficiente'
  | 'sem-marcadores'
  | 'abaixo-do-limiar'
  | 'margem-insuficiente';

export interface Classificacao {
  veredito: Veredito;
  /** A língua de maior pontuação, antes de qualquer limiar (null sem pontos). */
  vencedora: Idioma | null;
  confianca: number;
  margem: number;
  pontos: Pontos;
  palavras: number;
  palavrasAntes: number;
  motivo: Motivo;
}

export function classificarLimpo(
  limpeza: Limpeza,
  m: Marcadores,
  p: Pick<Parametros, 'minPalavras' | 'limiar' | 'margem'>,
): Classificacao {
  const pontos = pontuar(limpeza, m);
  const total = pontos.pt + pontos.es + pontos.en;
  const ordem = [...IDIOMAS].sort((a, b) => pontos[b] - pontos[a]);
  const [primeira, segunda] = ordem as [Idioma, Idioma, Idioma];
  const confianca = total === 0 ? 0 : pontos[primeira] / total;
  const margem = total === 0 ? 0 : (pontos[primeira] - pontos[segunda]) / total;
  const base = {
    vencedora: total === 0 ? null : primeira,
    confianca,
    margem,
    pontos,
    palavras: limpeza.palavras.length,
    palavrasAntes: limpeza.palavrasAntes,
  };
  if (
    limpeza.palavras.length === 0 ||
    limpeza.palavras.length < p.minPalavras
  ) {
    return {
      ...base,
      veredito: 'indeterminado',
      motivo: 'evidencia-insuficiente',
    };
  }
  if (total === 0)
    return { ...base, veredito: 'indeterminado', motivo: 'sem-marcadores' };
  if (confianca < p.limiar)
    return { ...base, veredito: 'indeterminado', motivo: 'abaixo-do-limiar' };
  // Empate exato na liderança cai aqui: margem 0 nunca passa.
  if (margem < p.margem || margem === 0) {
    return {
      ...base,
      veredito: 'indeterminado',
      motivo: 'margem-insuficiente',
    };
  }
  return { ...base, veredito: primeira, motivo: 'decidido' };
}

export function classificar(
  texto: string,
  m: Marcadores = AT080,
  p: Parametros = PARAMETROS_AT080,
): Classificacao {
  return classificarLimpo(limpar(texto, p), m, p);
}

// --------------------------------------------------- amostra e histerese

export interface Passo {
  classificacao: Classificacao;
  /** O idioma confiável DEPOIS desta mensagem (null = nenhum ainda). */
  estado: Idioma | null;
  trocou: boolean;
}

/**
 * Reproduz o que a api faria a cada mensagem do usuário (gatilho "a cada
 * mensagem", AT-080): monta a amostra com as N últimas mensagens já LIMPAS,
 * corta nas mais recentes até o teto de caracteres, classifica, e só troca o
 * estado depois de `histerese` avaliações SEGUIDAS apontando o mesmo idioma
 * novo. `indeterminado` nunca muda nada — e quebra a sequência.
 */
export function avaliarSequencia(
  mensagens: readonly string[],
  m: Marcadores = AT080,
  p: Parametros = PARAMETROS_AT080,
  inicial: Idioma | null = null,
): Passo[] {
  const limpas: string[] = [];
  const passos: Passo[] = [];
  let estado = inicial;
  let candidato: Idioma | null = null;
  let seguidas = 0;
  for (const mensagem of mensagens) {
    limpas.push(limpar(mensagem, p).texto);
    let amostra = limpas.slice(-p.janelaMensagens).join('\n');
    if (amostra.length > p.janelaCaracteres)
      amostra = amostra.slice(-p.janelaCaracteres);
    const classificacao = classificarLimpo(
      {
        texto: amostra,
        palavras: palavrasDe(amostra),
        palavrasAntes: palavrasDe(amostra).length,
      },
      m,
      p,
    );
    let trocou = false;
    const v = classificacao.veredito;
    if (v === 'indeterminado' || v === estado) {
      candidato = null;
      seguidas = 0;
    } else {
      seguidas = v === candidato ? seguidas + 1 : 1;
      candidato = v;
      if (seguidas >= p.histerese) {
        estado = v;
        trocou = true;
        candidato = null;
        seguidas = 0;
      }
    }
    passos.push({ classificacao, estado, trocou });
  }
  return passos;
}

// ------------------------------------------- a evidência do autor (itens 5 e 6)

/** O mínimo de um evento do event log que decide se ele é evidência. */
export interface EventoDoAutor {
  tipo: string;
  payload: { text?: unknown; answers?: unknown };
}

export interface Evidencia<E> {
  evento: E;
  texto: string;
  caso: 'chat' | 'formulario';
}

/** Começo do texto que `AnswerStructuredQuestionUseCase` monta: `1. {label}: `. */
const TEXTO_DO_FORMULARIO = /^1\. [^\n]*: /;

/**
 * Do que o AUTOR escreveu, o que é EVIDÊNCIA do idioma dele (AT-080, itens 5 e
 * 6) — a regra que a extração do corpus real (AT-160) e a detecção do produto
 * (AT-163) usam, daqui, as duas.
 *
 * Quem chama já filtrou por ator `user` (item 6: mensagem de agente e de
 * sistema nunca é evidência) e entrega os eventos de UM autor em ordem
 * crescente, agrupados por `chave` (a sessão, para a extração que mistura
 * autores; a sessão também para o produto). No formulário estruturado só as
 * RESPOSTAS entram (item 5): `chat.structured_question_answered` vira uma
 * evidência com os valores, e o `chat.message` concatenado que a api grava
 * logo depois (`"N. {label}: {resposta}"`, com o `label` escrito pelo AGENTE)
 * é pulado.
 */
export function evidenciasDoAutor<E extends EventoDoAutor>(
  eventos: readonly E[],
  chave: (e: E) => string,
): Evidencia<E>[] {
  const saida: Evidencia<E>[] = [];
  const ecoPendente = new Set<string>();
  for (const e of eventos) {
    const k = chave(e);
    if (e.tipo === 'chat.structured_question_answered') {
      const respostas =
        e.payload.answers && typeof e.payload.answers === 'object'
          ? Object.values(e.payload.answers as Record<string, unknown>).filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
      ecoPendente.add(k);
      if (respostas.length) {
        saida.push({
          evento: e,
          texto: respostas.join('\n'),
          caso: 'formulario',
        });
      }
      continue;
    }
    const texto = typeof e.payload.text === 'string' ? e.payload.text : '';
    if (ecoPendente.has(k)) {
      ecoPendente.delete(k);
      if (TEXTO_DO_FORMULARIO.test(texto)) continue;
    }
    if (texto.trim() === '') continue;
    saida.push({ evento: e, texto, caso: 'chat' });
  }
  return saida;
}

// ----------------------------------------------- a histerese sem estado guardado

/**
 * Quantas mensagens do autor a detecção precisa ler para decidir: a janela da
 * amostra mais as `histerese - 1` anteriores, para refazer as avaliações que a
 * histerese compara.
 */
export function mensagensNecessarias(
  p: Pick<Parametros, 'janelaMensagens' | 'histerese'>,
): number {
  return p.janelaMensagens + Math.max(p.histerese, 1) - 1;
}

/**
 * O idioma que as ÚLTIMAS `histerese` avaliações da amostra apontam JUNTAS, ou
 * `null` (AT-163, RN-624).
 *
 * É a histerese da AT-080 ("trocar só depois de 2 avaliações seguidas
 * concordando") sem estado guardado: o gatilho é "a cada mensagem", então a
 * avaliação que teria sido feita na mensagem anterior é REFEITA aqui, com a
 * janela que terminava nela — a mesma amostra, o mesmo veredito, sem uma
 * tabela para lembrá-lo. Um `indeterminado` em qualquer uma delas quebra a
 * concordância, como em `avaliarSequencia`.
 *
 * `mensagens` em ordem crescente (a mais recente por último), já só as
 * evidências do autor.
 */
export function idiomaConcordante(
  mensagens: readonly string[],
  m: Marcadores = AT080,
  p: Parametros = PARAMETROS_PROVISORIOS,
): Idioma | null {
  const limpas = mensagens.map((t) => limpar(t, p).texto);
  const n = Math.max(p.histerese, 1);
  if (limpas.length === 0) return null;
  let concordante: Idioma | null = null;
  for (let passo = n - 1; passo >= 0; passo--) {
    const fim = limpas.length - passo;
    if (fim <= 0) return null;
    let amostra = limpas
      .slice(Math.max(0, fim - p.janelaMensagens), fim)
      .join('\n');
    if (amostra.length > p.janelaCaracteres)
      amostra = amostra.slice(-p.janelaCaracteres);
    const palavras = palavrasDe(amostra);
    const v = classificarLimpo(
      { texto: amostra, palavras, palavrasAntes: palavras.length },
      m,
      p,
    ).veredito;
    if (v === 'indeterminado') return null;
    if (concordante !== null && v !== concordante) return null;
    concordante = v;
  }
  return concordante;
}
