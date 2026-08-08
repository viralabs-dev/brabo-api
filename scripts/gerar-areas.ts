/**
 * Gera as cópias derivadas da lista de áreas de agentes (FASE 18, item 11).
 *
 * ## Uma fonte, duas derivadas
 *
 * A lista de áreas existia HARDCODED em três lugares — api, web e engine — e o
 * risco disso já era o achado #4 do primeiro dogfooding ("dois lugares que
 * podem divergir"). O teste travava api contra web lendo a AST do web, o que
 * cobria dois dos três: o engine podia divergir em silêncio.
 *
 * A FONTE é `src/domain/agents/agent-areas.ts`, e não um YAML novo, por três
 * motivos: é a única cópia que tem o PREDICADO da área dinâmica de dev (que
 * nenhum formato de dado expressa), é o lado que precisa decidir handoff sem
 * consultar banco, e é de lá que o seeding da RN-094 lê. As outras duas passam
 * a ser GERADAS daqui — hoje `web` e `engine` são consumidores de uma lista
 * pequena e estável, e gerar arquivo é mais barato (e mais verificável em CI)
 * que fazer três runtimes lerem um registro em disco.
 *
 * Rodar: `pnpm --filter api gerar:areas`.
 * O teste `test/domain/agents/agent-areas.spec.ts` reprova quando o que está
 * em disco não é o que este gerador produz — é ele que torna a derivação real
 * em vez de combinada.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_AREAS,
  type AreaDeAgentes,
} from '../src/domain/agents/agent-areas';

const RAIZ = join(__dirname, '../../..');

export const CAMINHO_WEB = join(
  RAIZ,
  'apps/web/src/lib/agent-areas.generated.ts',
);
export const CAMINHO_ENGINE = join(
  RAIZ,
  'apps/engine/lib/engine/agents/areas.ex',
);

const AVISO =
  'GERADO por `pnpm --filter api gerar:areas` a partir de\n' +
  '`apps/api/src/domain/agents/agent-areas.ts`. NÃO edite à mão: a próxima\n' +
  'geração sobrescreve, e o teste `agent-areas.spec.ts` reprova a divergência.';

export function renderWeb(areas: readonly AreaDeAgentes[]): string {
  const linhas = areas.map((area) => {
    const membros = area.members.map((m) => `'${m}'`).join(', ');
    return (
      `  ${area.key}: {\n` +
      `    key: '${area.key}',\n` +
      `    label: '${area.label}',\n` +
      `    lead: '${area.lead}',\n` +
      `    members: [${membros}],\n` +
      `  },`
    );
  });

  return (
    `/**\n` +
    ` * ${AVISO.split('\n').join('\n * ')}\n` +
    ` *\n` +
    ` * A área de \`dev\` sai daqui com \`members\` vazio, e não é omissão: os\n` +
    ` * membros dela são um por módulo do \`module_map\`, por projeto, e vêm de\n` +
    ` * \`agent_areas\`/\`agent_area_members\` (RN-094).\n` +
    ` */\n` +
    `import type { AreaDef } from './agents';\n` +
    `\n` +
    `export const AREAS: Record<string, AreaDef> = {\n` +
    `${linhas.join('\n')}\n` +
    `};\n`
  );
}

export function renderEngine(areas: readonly AreaDeAgentes[]): string {
  const linhas = areas.map((area) => {
    const membros = area.members.map((m) => `"${m}"`).join(', ');
    return (
      `    %{\n` +
      `      key: "${area.key}",\n` +
      `      label: "${area.label}",\n` +
      `      lead: "${area.lead}",\n` +
      `      members: [${membros}]\n` +
      `    }`
    );
  });

  return (
    `defmodule Engine.Agents.Areas do\n` +
    `  @moduledoc """\n` +
    `  ${AVISO.split('\n').join('\n  ')}\n` +
    `\n` +
    `  As áreas do ADR 0038: um lead como contato externo, subagentes por dentro.\n` +
    `  Aqui só a lista — a REGRA de endereçamento de handoff mora na api, que é\n` +
    `  quem grava \`handoffs\`.\n` +
    `\n` +
    `  \`dev\` vem com \`members\` vazio de propósito: os membros dela são um por\n` +
    `  módulo do \`module_map\`, por projeto, e o engine os conhece pelo\n` +
    `  \`session_id\` que sobe, não por esta lista.\n` +
    `  """\n` +
    `\n` +
    `  @areas [\n` +
    `${linhas.join(',\n')}\n` +
    `  ]\n` +
    `\n` +
    `  @doc "Todas as áreas, na ordem canônica da api."\n` +
    `  def all, do: @areas\n` +
    `\n` +
    `  @doc "O lead da área, ou \`nil\` se a chave não existe."\n` +
    `  def lead(key) do\n` +
    `    case Enum.find(@areas, &(&1.key == key)) do\n` +
    `      nil -> nil\n` +
    `      area -> area.lead\n` +
    `    end\n` +
    `  end\n` +
    `\n` +
    `  @doc "Os subagentes da área (lista vazia quando a área não existe)."\n` +
    `  def membros(key) do\n` +
    `    case Enum.find(@areas, &(&1.key == key)) do\n` +
    `      nil -> []\n` +
    `      area -> area.members\n` +
    `    end\n` +
    `  end\n` +
    `end\n`
  );
}

export function gerar(): void {
  writeFileSync(CAMINHO_WEB, renderWeb(AGENT_AREAS), 'utf-8');
  writeFileSync(CAMINHO_ENGINE, renderEngine(AGENT_AREAS), 'utf-8');
}

if (require.main === module) {
  gerar();
  // eslint-disable-next-line no-console
  console.log(`gerado:\n  ${CAMINHO_WEB}\n  ${CAMINHO_ENGINE}`);
}
