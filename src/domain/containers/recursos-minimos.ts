/**
 * O MENOR recurso elegível do container de um projeto, DERIVADO do
 * `module_map` (AT-261, RN-683, ADR 0199).
 *
 * Puro, sem IO. Até aqui a Infra subia o container com `RECURSOS_PADRAO`
 * sempre que o modelo omitia `resources` — e a subida do servidor no aceite
 * (ADR 0190) omitia sempre —, sem noção nenhuma de mínimo. A decisão do dono
 * (01/10) é que o mínimo vem do que o ARQUITETO declara por módulo, e não de
 * um preset por stack: quem conhece o módulo é quem o desenhou.
 *
 * ## Soma, e não máximo
 *
 * Um projeto tem UM container (`project_id UNIQUE` em `project_containers`),
 * e todos os módulos do mapa moram nele ao mesmo tempo: o dev agent de cada
 * módulo trabalha ali, em paralelo quando a área paraleliza, e o servidor de
 * dev de um não desliga para o do outro rodar. O número que o Arquiteto
 * declara para um módulo é o que ELE precisa sozinho; o máximo entre módulos
 * só serviria se nunca houvesse dois de pé, e subdimensionar memória termina
 * em OOM-kill no meio de um comando, não numa recusa legível. Por isso o
 * mínimo é a SOMA, campo a campo. O preço é que a soma pode passar do teto:
 * isso é recusado já na criação do mapa (`validarSomaNoTeto`), onde quem pode
 * corrigir — o Arquiteto — lê o motivo.
 *
 * ## Módulo sem declaração
 *
 * Nunca se inventa número para ele. O único número que existe para um módulo
 * não declarado é o que ele recebe HOJE: o padrão do container. Então, se
 * algum módulo não declarou, o container nunca cai abaixo de `RECURSOS_PADRAO`
 * (o mínimo é o MAIOR entre a soma dos declarados e o padrão, campo a campo);
 * só com TODOS declarados o mínimo pode ficar abaixo do padrão. Mapa sem
 * declaração nenhuma — todo mapa gravado antes desta regra — dá exatamente o
 * padrão de hoje, e o comportamento não muda para ele. Quem ficou sem
 * declaração é NOMEADO na explicação, que vai para o `rationale` do artefato.
 */
import {
  ImagemInvalidaError,
  RECURSOS_MAXIMOS,
  RECURSOS_PADRAO,
  type RecursosDoContainer,
} from './project-container';

const CAMPOS: readonly (keyof RecursosDoContainer)[] = [
  'cpus',
  'memoryMb',
  'pidsLimit',
];

/** O que a derivação precisa de um módulo: o nome e o que ele declarou. */
export interface ModuloComRecursos {
  name: string;
  resources?: RecursosDoContainer;
}

export interface RecursosMinimos {
  recursos: RecursosDoContainer;
  /** Módulos que declararam recurso, na ordem do mapa. */
  declarados: string[];
  /** Módulos sem declaração, na ordem do mapa. */
  semDeclaracao: string[];
}

export class RecursosDoModuloInvalidosError extends Error {}

/**
 * Valida o `resources` que o Arquiteto declarou para UM módulo. Ausente é
 * válido (`undefined`); presente exige os TRÊS campos, positivos e cada um no
 * teto — declaração pela metade não é declaração, e completar o campo que
 * faltou com o padrão seria inventar o número que a regra proíbe.
 */
export function validarRecursosDoModulo(
  modulo: string,
  entrada: unknown,
): RecursosDoContainer | undefined {
  if (entrada === undefined || entrada === null) return undefined;
  if (typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new RecursosDoModuloInvalidosError(
      `Módulo "${modulo}": resources precisa ser um objeto com cpus, memoryMb e pidsLimit.`,
    );
  }
  const bruto = entrada as Record<string, unknown>;
  const recursos = {} as RecursosDoContainer;
  for (const campo of CAMPOS) {
    const valor = bruto[campo];
    const n = typeof valor === 'number' ? valor : Number(valor);
    if (
      valor === undefined ||
      valor === null ||
      !Number.isFinite(n) ||
      n <= 0
    ) {
      throw new RecursosDoModuloInvalidosError(
        `Módulo "${modulo}": resources.${campo} precisa ser um número positivo — ` +
          'declare os três (cpus, memoryMb, pidsLimit) ou nenhum.',
      );
    }
    if (n > RECURSOS_MAXIMOS[campo]) {
      throw new RecursosDoModuloInvalidosError(
        `Módulo "${modulo}": resources.${campo} = ${n} passa do teto de ` +
          `${RECURSOS_MAXIMOS[campo]} do container.`,
      );
    }
    recursos[campo] = n;
  }
  return recursos;
}

/** O mínimo do container a partir dos módulos do mapa vigente (soma + piso). */
export function derivarRecursosMinimos(
  modulos: readonly ModuloComRecursos[],
): RecursosMinimos {
  const declarados = modulos.filter((m) => m.resources);
  const semDeclaracao = modulos.filter((m) => !m.resources).map((m) => m.name);

  if (declarados.length === 0) {
    return {
      recursos: { ...RECURSOS_PADRAO },
      declarados: [],
      semDeclaracao,
    };
  }

  const soma = { cpus: 0, memoryMb: 0, pidsLimit: 0 };
  for (const m of declarados) {
    for (const campo of CAMPOS) soma[campo] += m.resources![campo];
  }
  // Soma de frações de CPU em ponto flutuante (0.1 + 0.2) não pode virar
  // 0.30000000000000004 no artefato.
  soma.cpus = Math.round(soma.cpus * 1000) / 1000;

  const recursos =
    semDeclaracao.length === 0
      ? soma
      : {
          cpus: Math.max(soma.cpus, RECURSOS_PADRAO.cpus),
          memoryMb: Math.max(soma.memoryMb, RECURSOS_PADRAO.memoryMb),
          pidsLimit: Math.max(soma.pidsLimit, RECURSOS_PADRAO.pidsLimit),
        };

  return {
    recursos,
    declarados: declarados.map((m) => m.name),
    semDeclaracao,
  };
}

/**
 * O mínimo derivado precisa caber no teto do container. Lança com a mensagem
 * que volta ao Arquiteto (criação do mapa) ou que vira `failed` nomeado (subida).
 */
export function validarSomaNoTeto(minimo: RecursosMinimos): void {
  for (const campo of CAMPOS) {
    if (minimo.recursos[campo] > RECURSOS_MAXIMOS[campo]) {
      throw new RecursosDoModuloInvalidosError(
        `A soma dos recursos declarados pelos módulos dá ${campo} = ` +
          `${minimo.recursos[campo]}, acima do teto de ${RECURSOS_MAXIMOS[campo]} ` +
          'do container — todos os módulos dividem UM container, então o mínimo ' +
          'é a soma. Reduza o que cada módulo declara.',
      );
    }
  }
}

/**
 * Os recursos com que a Infra sobe o container: campo OMITIDO vira o mínimo
 * derivado; campo informado ABAIXO do mínimo é recusado (subir abaixo do que os
 * módulos declararam seria um container que o próprio mapa diz não bastar —
 * e rebaixar em silêncio é o defeito que o teto já recusa no outro sentido);
 * acima do mínimo vale, e o teto continua sendo conferido por
 * `validarDecisaoDeImagem`.
 */
export function resolverRecursosDaSubida(
  pedido: unknown,
  minimo: RecursosMinimos,
): RecursosDoContainer {
  const bruto =
    pedido && typeof pedido === 'object' && !Array.isArray(pedido)
      ? (pedido as Record<string, unknown>)
      : {};
  const recursos = {} as RecursosDoContainer;
  for (const campo of CAMPOS) {
    const valor = bruto[campo];
    if (valor === undefined || valor === null) {
      recursos[campo] = minimo.recursos[campo];
      continue;
    }
    const n = typeof valor === 'number' ? valor : Number(valor);
    if (Number.isFinite(n) && n > 0 && n < minimo.recursos[campo]) {
      throw new ImagemInvalidaError(
        `resources.${campo} = ${n} fica abaixo do mínimo de ` +
          `${minimo.recursos[campo]} derivado do module_map ` +
          `(${explicarRecursosMinimos(minimo)}). Omita o campo para subir com o mínimo.`,
      );
    }
    // Inválido (não-número, <= 0) segue adiante e é recusado com a mensagem de
    // sempre por `validarDecisaoDeImagem`.
    recursos[campo] = valor as number;
  }
  return recursos;
}

function formatar(r: RecursosDoContainer): string {
  return `${r.cpus} cpus, ${r.memoryMb} MiB, ${r.pidsLimit} pids`;
}

/** A frase que vai para o `rationale` do artefato — diz de onde veio cada número. */
export function explicarRecursosMinimos(minimo: RecursosMinimos): string {
  if (minimo.declarados.length === 0) {
    return (
      'nenhum módulo do module_map declarou recurso; vale o padrão de hoje ' +
      `(${formatar(RECURSOS_PADRAO)})`
    );
  }
  const base =
    `soma do que ${minimo.declarados.length} módulo(s) declararam ` +
    `(${minimo.declarados.join(', ')})`;
  if (minimo.semDeclaracao.length === 0) {
    return `${base}: ${formatar(minimo.recursos)}`;
  }
  return (
    `${base}, com piso no padrão de hoje porque ${minimo.semDeclaracao.join(', ')} ` +
    `não declarou recurso: ${formatar(minimo.recursos)}`
  );
}
