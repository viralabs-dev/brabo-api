// Pergunta em aberto de agente (AT-521, RN-858, ADR 0214).
//
// Puro e sem framework. A pergunta é EVENTO (`artifact.open_question`), e o
// fechamento é outro evento (`open_question.answered`): o STATUS sai do log —
// aberta é a que não tem `answered` com o mesmo `questionId` —, nunca de
// tabela, a mesma régua dos demais artefatos (append-only).

export const EVENTO_PERGUNTA_EM_ABERTO = 'artifact.open_question';
export const EVENTO_PERGUNTA_RESPONDIDA = 'open_question.answered';

export const TETO_DA_PERGUNTA = 500;
export const TETO_DA_SUGESTAO = 300;
export const TETO_DA_RESPOSTA = 2000;

export interface AfetaDaPergunta {
  regras: string[];
  historias: string[];
  tarefas: string[];
}

export interface PayloadDaPergunta {
  questionId: string;
  pergunta: string;
  sugestao?: string;
  afeta: AfetaDaPergunta;
  autor: string;
  sessionId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listaDeIds(valor: unknown): string[] | null {
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) return null;
  return valor.every((v) => typeof v === 'string' && v.trim() !== '')
    ? (valor as string[])
    : null;
}

/**
 * Valida o payload de `artifact.open_question` contra o contrato. Devolve o
 * payload normalizado ou a frase da recusa (que vira 400 e chega ao modelo).
 */
export function validarPerguntaEmAberto(
  payload: unknown,
): { ok: true; valor: PayloadDaPergunta } | { ok: false; motivo: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, motivo: 'payload ausente' };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.questionId !== 'string' || !UUID.test(p.questionId)) {
    return { ok: false, motivo: '`questionId` precisa ser um uuid' };
  }
  const pergunta = typeof p.pergunta === 'string' ? p.pergunta.trim() : '';
  if (pergunta === '' || pergunta.length > TETO_DA_PERGUNTA) {
    return {
      ok: false,
      motivo: `\`pergunta\` precisa ter entre 1 e ${TETO_DA_PERGUNTA} caracteres`,
    };
  }
  let sugestao: string | undefined;
  if (p.sugestao !== undefined && p.sugestao !== null) {
    if (typeof p.sugestao !== 'string') {
      return { ok: false, motivo: '`sugestao` precisa ser texto' };
    }
    sugestao = p.sugestao.trim() || undefined;
    if (sugestao && sugestao.length > TETO_DA_SUGESTAO) {
      return {
        ok: false,
        motivo: `\`sugestao\` passa de ${TETO_DA_SUGESTAO} caracteres`,
      };
    }
  }
  const afeta = (p.afeta ?? {}) as Record<string, unknown>;
  if (typeof afeta !== 'object') {
    return { ok: false, motivo: '`afeta` precisa ser um objeto' };
  }
  const regras = listaDeIds(afeta.regras);
  const historias = listaDeIds(afeta.historias);
  const tarefas = listaDeIds(afeta.tarefas);
  if (!regras || !historias || !tarefas) {
    return {
      ok: false,
      motivo: '`afeta.regras`/`historias`/`tarefas` são listas de ids',
    };
  }
  if (typeof p.autor !== 'string' || p.autor.trim() === '') {
    return { ok: false, motivo: '`autor` ausente' };
  }
  if (typeof p.sessionId !== 'string' || p.sessionId.trim() === '') {
    return { ok: false, motivo: '`sessionId` ausente' };
  }
  return {
    ok: true,
    valor: {
      questionId: p.questionId,
      pergunta,
      ...(sugestao ? { sugestao } : {}),
      afeta: { regras, historias, tarefas },
      autor: p.autor,
      sessionId: p.sessionId,
    },
  };
}

export type StatusDaPergunta = 'open' | 'answered';

/**
 * A resposta escolhida: texto livre OU a sugestão do agente. `null` quando o
 * corpo não diz nenhuma das duas (ou aceita uma sugestão que não existe).
 */
export function respostaEscolhida(
  sugestao: string | undefined,
  corpo: { resposta?: string; aceitarSugestao?: boolean },
): { resposta: string; aceitouSugestao: boolean } | null {
  if (corpo.aceitarSugestao === true) {
    return sugestao ? { resposta: sugestao, aceitouSugestao: true } : null;
  }
  const texto = corpo.resposta?.trim() ?? '';
  if (texto === '' || texto.length > TETO_DA_RESPOSTA) return null;
  return { resposta: texto, aceitouSugestao: false };
}

/** Texto de "o que afeta", para o `consequences` do `decision_record`. */
export function descreverAfeta(afeta: AfetaDaPergunta): string {
  const partes: string[] = [];
  if (afeta.regras.length) partes.push(`regras: ${afeta.regras.join(', ')}`);
  if (afeta.historias.length)
    partes.push(`histórias: ${afeta.historias.join(', ')}`);
  if (afeta.tarefas.length) partes.push(`tarefas: ${afeta.tarefas.join(', ')}`);
  return partes.length ? partes.join('; ') : 'nada declarado';
}

/** A decisão afeta a história/tarefa/regras pedidas? */
export function afetaAlgum(
  afeta: Partial<AfetaDaPergunta> | undefined,
  alvo: { regras: string[]; historias: string[]; tarefas: string[] },
): boolean {
  if (!afeta) return false;
  const bate = (lista: unknown, ids: string[]) =>
    Array.isArray(lista) && lista.some((id) => ids.includes(id as string));
  return (
    bate(afeta.regras, alvo.regras) ||
    bate(afeta.historias, alvo.historias) ||
    bate(afeta.tarefas, alvo.tarefas)
  );
}

/**
 * RN-870 (AT-526): o estado de uma pergunta pelo log do projeto — inexistente
 * (ou de outro projeto, que é a mesma coisa vista daqui), aberta ou já
 * respondida, com o texto da decisão. Pura.
 */
export function estadoDaPergunta(
  questionId: string,
  perguntas: ReadonlyArray<{ payload: unknown }>,
  respostas: ReadonlyArray<{ payload: unknown }>,
):
  | { estado: 'inexistente' }
  | { estado: 'aberta' }
  | { estado: 'respondida'; resposta: string } {
  const doId = (e: { payload: unknown }) =>
    (e.payload as { questionId?: unknown })?.questionId === questionId;
  if (!perguntas.some(doId)) return { estado: 'inexistente' };
  const resposta = respostas.find(doId);
  if (!resposta) return { estado: 'aberta' };
  const texto = (resposta.payload as { resposta?: unknown }).resposta;
  return {
    estado: 'respondida',
    resposta: typeof texto === 'string' ? texto : '',
  };
}

/**
 * RN-871 (AT-526): `afeta.regras` aceita o id de um `artifact.business_rule`
 * do projeto ou o TÍTULO exato de um — que vira o id (o mais recente, se o
 * título se repete). O que não resolve é recusa nomeada. Pura.
 */
export function resolverRegrasDoAfeta(
  regras: string[],
  doProjeto: ReadonlyArray<{ id: string; title: string; createdAt: Date }>,
): { ok: true; regras: string[] } | { ok: false; motivo: string } {
  const ids = new Set(doProjeto.map((r) => r.id));
  const recentes = [...doProjeto].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const resolvidas: string[] = [];
  const faltam: string[] = [];
  for (const r of regras) {
    if (ids.has(r)) {
      resolvidas.push(r);
      continue;
    }
    const porTitulo = recentes.find((x) => x.title === r);
    if (porTitulo) resolvidas.push(porTitulo.id);
    else faltam.push(r);
  }
  if (faltam.length) {
    return {
      ok: false,
      motivo: `\`afeta.regras\` não é id nem título exato de regra de negócio do projeto: ${faltam
        .map((f) => `"${f}"`)
        .join(', ')}`,
    };
  }
  return { ok: true, regras: [...new Set(resolvidas)] };
}
