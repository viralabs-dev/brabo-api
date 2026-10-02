import { PROFICIENCY_LEVELS } from './proficiency-validation';

/**
 * O NÍVEL por competência de quem escreveu a mensagem, para o agente que a
 * responde calibrar quantas perguntas faz e em que profundidade explica
 * (RN-696, AT-356). Vai pelo MESMO caminho dos fatos do perfil (RN-680):
 * `perfilDoAutor` no `agent/message`, mensagem de sistema efêmera no engine —
 * nenhum servidor de agente muda.
 *
 * Só `competência: nível`. O `rationale` e as evidências NÃO vão: são a
 * leitura da Anamnese sobre a pessoa, e o que o agente precisa para calibrar
 * é o nível. Nível fora da escala é descartado aqui (segunda barreira; a
 * primeira, catálogo incluso, é a gravação em `RecordProficiencyUseCase`).
 */
export const COMPETENCIAS_NO_CONTEXTO = 12;

export interface NivelDeCompetencia {
  competency: string;
  level: string;
}

export function textoDaProficienciaDoAutor(
  perfis: readonly NivelDeCompetencia[],
): string | null {
  const validos = perfis
    .filter(
      (p) =>
        p.competency.trim() !== '' &&
        (PROFICIENCY_LEVELS as readonly string[]).includes(p.level),
    )
    .slice(0, COMPETENCIAS_NO_CONTEXTO);
  if (validos.length === 0) return null;

  const linhas = validos.map((p) => `- ${p.competency}: ${p.level}`);
  return (
    'Nível de proficiência de quem escreveu esta mensagem, por competência ' +
    'técnica ou de processo, neste projeto. Calibre por ele quantas perguntas ' +
    'faz e quanto explica: mais perguntas e explicação em "iniciante", menos ' +
    `e mais direto em "avancado".\n${linhas.join('\n')}`
  );
}
