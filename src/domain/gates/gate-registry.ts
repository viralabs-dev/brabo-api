/**
 * O registro de gates (`docs/gates.yml`) como tipo e como regra.
 *
 * Puro, sem IO: quem lê o arquivo é o loader na infraestrutura. Aqui mora só o
 * que é verdade sobre um registro válido — do mesmo jeito que `decide.ts` é a
 * regra do pipeline de ações e não sabe de HTTP.
 *
 * O validador ACUMULA problemas em vez de lançar no primeiro, como o
 * `scripts/docs/docmap.mjs` faz: quem edita o YAML quer a lista inteira do que
 * está errado, não descobrir um erro por vez.
 */

export type Verificacao = 'script' | 'humana';
export type Severidade = 'block' | 'warn';
export type StatusGate = 'active' | 'planned';
export type TipoDeEvidencia = 'event_log' | 'teste' | 'ci';

export interface EvidenciaEventLog {
  tipo: 'event_log';
  /** Tipos de `session_events` que provam a passagem. */
  event_types: string[];
  /**
   * Filtro sobre o payload. Existe porque tipo não basta: `qa-verificada` e
   * `secops-segura` gravam o MESMO `pr.gate_changed`, e o mesmo tipo sai na
   * ABERTURA do gate sem `veredito` — sem filtro, abertura contaria como
   * passagem.
   */
  filtro?: Record<string, string>;
  onde?: string;
}

export interface EvidenciaArquivo {
  tipo: 'teste' | 'ci';
  arquivo: string;
  workflow?: string;
  onde?: string;
}

export type Evidencia = EvidenciaEventLog | EvidenciaArquivo;

export interface Gate {
  id: string;
  fluxo: string;
  dono: string;
  entrada: string[];
  entregavel: string | string[];
  verificacao: Verificacao;
  severidade: Severidade;
  aprovacao_humana: boolean;
  status: StatusGate;
  evidencia?: Evidencia;
  backlog?: string;
}

export interface GateRegistry {
  version: number;
  gates: Gate[];
}

/**
 * Os gates que a constituição declara manuais. `aprovacao_humana` neles não é
 * configuração: é invariante, e nenhum modo de produto os automatiza.
 *
 * Vale a mesma disciplina da trava de merge, que já é garantida por teste desde
 * a Fase 4 — a diferença é que agora está escrito num lugar só.
 */
export const GATES_HUMANOS_IMUTAVEIS: readonly string[] = [
  'acao-aprovada',
  'story-promovida',
  'plano-de-adocao',
  'merge-protegida',
];

export interface ProblemaDeRegistro {
  gate: string | null;
  tipo: string;
  detalhe: string;
}

/**
 * Valida o que é verdade sobre o registro OLHANDO SÓ PARA ELE. Devolve a lista
 * de problemas — vazia quer dizer válido.
 *
 * **Sem IO, e agora sem nem a possibilidade de IO.** Até a correção do
 * `GET /gates` esta função também recebia um `arquivoExiste` e cobrava que o
 * arquivo de prova citado por `evidencia` estivesse no disco. Essa outra
 * pergunta continua existindo e continua sendo cobrada — mudou de função, para
 * `validarLocalizadores`, porque as duas não são afirmações sobre a mesma
 * coisa: esta é sobre o CONTEÚDO do registro (vale onde quer que ele seja
 * lido), aquela é sobre o REPOSITÓRIO (só vale dentro de um checkout). Juntas
 * numa função só, quem lê o registro era obrigado a responder as duas, e a
 * imagem de produção — que carrega `docs/gates.yml` e nenhum `test/`,
 * `scripts/` ou `.github/` — respondia "não existe" para todas.
 */
export function validarRegistro(registro: GateRegistry): ProblemaDeRegistro[] {
  const problemas: ProblemaDeRegistro[] = [];
  const vistos = new Set<string>();

  if (registro.version !== 1) {
    problemas.push({
      gate: null,
      tipo: 'versao-desconhecida',
      detalhe: `version ${String(registro.version)} — só a 1 é conhecida`,
    });
  }

  for (const gate of registro.gates) {
    if (vistos.has(gate.id)) {
      problemas.push({
        gate: gate.id,
        tipo: 'id-duplicado',
        detalhe: 'dois gates com o mesmo id',
      });
    }
    vistos.add(gate.id);

    // RN-070 — `block` promete que alguém verifica de verdade.
    if (gate.severidade === 'block' && gate.verificacao !== 'script') {
      problemas.push({
        gate: gate.id,
        tipo: 'block-sem-script',
        detalhe:
          'gate `block` exige `verificacao: script` — sem script ele nasce `warn`',
      });
    }

    // RN-071 — os manuais por constituição.
    if (GATES_HUMANOS_IMUTAVEIS.includes(gate.id) && !gate.aprovacao_humana) {
      problemas.push({
        gate: gate.id,
        tipo: 'humano-imutavel-desligado',
        detalhe:
          '`aprovacao_humana` é invariante neste gate — nenhum modo de produto o automatiza',
      });
    }

    if (gate.status === 'active' && !gate.evidencia) {
      problemas.push({
        gate: gate.id,
        tipo: 'ativo-sem-evidencia',
        detalhe: 'gate `active` precisa declarar onde mora a prova dele',
      });
    }

    // `planned` é declaração de papel futuro: não pode carregar evidência de
    // algo que ainda não acontece, senão o script cobraria passagem de um gate
    // que ninguém ativou.
    if (gate.status === 'planned' && gate.evidencia) {
      problemas.push({
        gate: gate.id,
        tipo: 'planned-com-evidencia',
        detalhe: 'gate `planned` não passou por nada ainda',
      });
    }

    const evidencia = gate.evidencia;
    if (evidencia?.tipo === 'event_log' && evidencia.event_types.length === 0) {
      problemas.push({
        gate: gate.id,
        tipo: 'evidencia-sem-tipo',
        detalhe: 'evidência no event log sem nenhum `event_types`',
      });
    }
  }

  // `entrada` que nomeia outro gate tem que existir — é o que impede o registro
  // de descrever uma ordem que não fecha.
  for (const gate of registro.gates) {
    for (const entrada of gate.entrada) {
      if (vistos.has(entrada) || !pareceGate(entrada)) continue;
      problemas.push({
        gate: gate.id,
        tipo: 'entrada-orfa',
        detalhe: `entrada \`${entrada}\` parece um gate e não existe no registro`,
      });
    }
  }

  return problemas;
}

/** Um alvo de arquivo citado por `evidencia`, com o gate que o cita. */
export interface Localizador {
  gate: string;
  tipo: 'teste' | 'ci';
  /** Qual campo da evidência trouxe este alvo — o relatório do script usa. */
  campo: 'arquivo' | 'workflow';
  /** Caminho RELATIVO à raiz do repositório, como está escrito no YAML. */
  alvo: string;
}

/**
 * Todo alvo de arquivo que o registro cita, na ordem em que aparece.
 *
 * Existe como função própria porque há DOIS consumidores com necessidades
 * diferentes — a régua (`validarLocalizadores`) e o relatório por linha do
 * `validacao-gates.ts` —, e antes cada um enumerava os alvos por conta
 * própria, com recortes que já divergiam.
 */
export function localizadoresDoRegistro(registro: GateRegistry): Localizador[] {
  const localizadores: Localizador[] = [];

  for (const gate of registro.gates) {
    const evidencia = gate.evidencia;
    if (!evidencia || evidencia.tipo === 'event_log') continue;

    localizadores.push({
      gate: gate.id,
      tipo: evidencia.tipo,
      campo: 'arquivo',
      alvo: evidencia.arquivo,
    });
    if (evidencia.workflow) {
      localizadores.push({
        gate: gate.id,
        tipo: evidencia.tipo,
        campo: 'workflow',
        alvo: evidencia.workflow,
      });
    }
  }

  return localizadores;
}

/**
 * A régua do LOCALIZADOR: evidência de `teste`/`ci` aponta para arquivo que
 * existe (RN-070). Alvo que sumiu reprova — é o mesmo modo de falha que o
 * docmap chama de glob morto: regra que nunca dispara finge cobertura.
 *
 * **É afirmação sobre o REPOSITÓRIO, e por isso NÃO roda em runtime.** Quem a
 * cobra é o teste do arquivo real (`gate-registry.spec.ts`, que roda no CI a
 * cada PR) e a fase 2 do `validacao-gates.ts`. O loader da api NÃO a chama, e
 * essa ausência é a correção, não um esquecimento: a imagem de produção leva
 * `docs/gates.yml` e mais nada de `docs/` — sem `apps/api/test/`, sem
 * `scripts/ci/`, sem `.github/` —, então cobrar os alvos ali reprovava TODOS
 * e fazia `GET /gates` responder 500 em toda instalação. Não a mova de volta
 * para o loader: `arquivoExiste` num processo que não tem o repositório
 * responde sobre outra árvore.
 *
 * `arquivoExiste` é injetado para a regra continuar pura — o domínio afirma o
 * que tem de existir sem saber o que é um filesystem.
 */
export function validarLocalizadores(
  registro: GateRegistry,
  arquivoExiste: (caminho: string) => boolean,
): ProblemaDeRegistro[] {
  return localizadoresDoRegistro(registro)
    .filter((l) => !arquivoExiste(l.alvo))
    .map((l) => ({
      gate: l.gate,
      tipo: 'evidencia-inexistente',
      detalhe: `${l.alvo} não existe`,
    }));
}

/**
 * `entrada` mistura duas coisas: nome de outro GATE (`qa-verificada`) e nome de
 * um ARTEFATO que o dispara (`pr-aberta`, `proposed_action`). Só o primeiro é
 * cobrável. A heurística é conservadora de propósito — errar para o lado de não
 * cobrar é melhor que acusar um artefato de gate inexistente.
 */
function pareceGate(entrada: string): boolean {
  return entrada.endsWith('-verificada') || entrada.endsWith('-segura');
}

/** Os que o script de validação precisa cobrar. */
export function gatesCobraveis(registro: GateRegistry): Gate[] {
  return registro.gates.filter(
    (g) => g.status === 'active' && g.severidade === 'block',
  );
}
