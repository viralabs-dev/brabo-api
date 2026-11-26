// A explicação para leigo de um bloqueio (AT-1021, RN-1527): causa em uma
// frase e 1..2 ações prontas, cada uma um clique que retoma com `orientacao`
// (o `unblock` da RN-1124). Campo OPCIONAL ao lado de `blockedReason`.
import {
  MAX_DE_ACOES,
  TETO_DA_CAUSA,
  TETO_DA_ORIENTACAO,
  TETO_DO_CODIGO,
  TETO_DO_ROTULO,
  recusaDeFraseParaLeigo,
} from '../linguagem/frase-para-leigo';

export interface AcaoDoBloqueio {
  id?: string;
  rotulo: string;
  orientacao: string;
}

export interface ExplicacaoDoBloqueio {
  codigo?: string;
  causa: string;
  acoes: AcaoDoBloqueio[];
}

/** Valida e normaliza; `motivo` diz por que foi recusada (vira `logger.warn`). */
export function validarExplicacaoDoBloqueio(
  valor: unknown,
): { ok: true; valor: ExplicacaoDoBloqueio } | { ok: false; motivo: string } {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return { ok: false, motivo: 'explicacao não é um objeto' };
  }
  const v = valor as Record<string, unknown>;
  const recusaCausa = recusaDeFraseParaLeigo(v.causa, TETO_DA_CAUSA);
  if (recusaCausa) return { ok: false, motivo: `causa ${recusaCausa}` };
  let codigo: string | undefined;
  if (v.codigo !== undefined && v.codigo !== null) {
    if (typeof v.codigo !== 'string' || v.codigo.length > TETO_DO_CODIGO) {
      return { ok: false, motivo: 'codigo inválido' };
    }
    codigo = v.codigo || undefined;
  }
  if (
    !Array.isArray(v.acoes) ||
    v.acoes.length < 1 ||
    v.acoes.length > MAX_DE_ACOES
  ) {
    return { ok: false, motivo: `acoes precisa ter de 1 a ${MAX_DE_ACOES}` };
  }
  const acoes: AcaoDoBloqueio[] = [];
  for (const bruta of v.acoes as unknown[]) {
    const a = (bruta ?? {}) as Record<string, unknown>;
    const recusa = recusaDeFraseParaLeigo(a.rotulo, TETO_DO_ROTULO);
    if (recusa) return { ok: false, motivo: `rotulo ${recusa}` };
    // Orientação vazia é válida: "Tentar de novo" é o desbloqueio puro.
    const orientacao = a.orientacao ?? '';
    if (
      typeof orientacao !== 'string' ||
      orientacao.length > TETO_DA_ORIENTACAO
    ) {
      return { ok: false, motivo: 'orientacao inválida' };
    }
    if (
      a.id !== undefined &&
      (typeof a.id !== 'string' || a.id.length > TETO_DO_CODIGO)
    ) {
      return { ok: false, motivo: 'id da ação inválido' };
    }
    acoes.push({
      ...(a.id ? { id: a.id } : {}),
      rotulo: a.rotulo as string,
      orientacao,
    });
  }
  return {
    ok: true,
    valor: { ...(codigo ? { codigo } : {}), causa: v.causa as string, acoes },
  };
}
