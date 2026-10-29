/**
 * A rede declarada do container do projeto (AT-608, ADR 0228, RN-932):
 * `artifact.container_network` — versionado, sem tabela, o vigente substitui
 * (o desenho de `artifact.project_image`). Escrever isto NÃO é efeito externo;
 * só vale no container RECRIADO (`container_recreate`).
 *
 * A régua ESPELHA a de `packages/docker-port/src/spec-de-container.ts`
 * (`portasValidadas`/`dnsValidado`/`hostsExtrasValidados`), porque a api não
 * pode importar o pacote (`api-nao-consome-docker-port.spec.ts`). A paridade
 * é provada por `test/contract/rede-do-container-paridade.spec.ts`. O broker
 * revalida de qualquer jeito: esta validação é sobre o ARTEFATO.
 */
import { isIP } from 'node:net';

export const EVENTO_REDE_DO_CONTAINER = 'artifact.container_network';

export const PORTAS_DA_INSTALACAO: readonly number[] = [
  3000, 4000, 5173, 5432, 7474, 7687, 8088, 8090, 11434,
];
export const TETO_DE_PORTAS = 10;
export const TETO_DE_DNS = 3;
export const TETO_DE_HOSTS_EXTRAS = 10;
export const NOMES_RESERVADOS: readonly string[] = [
  'localhost',
  'host.docker.internal',
  'api',
  'engine',
  'web',
  'postgres',
  'neo4j',
  'broker',
  'ollama',
];

export interface PortaDeRede {
  host: number;
  container: number;
  protocol: 'tcp';
}
export interface HostExtraDeRede {
  name: string;
  ip: string;
}
export interface RedeDoContainer {
  ports: PortaDeRede[];
  dns: string[];
  extraHosts: HostExtraDeRede[];
}

export class RedeInvalidaError extends Error {
  constructor(
    readonly campo: string,
    detalhe: string,
  ) {
    super(`rede do container inválida em \`${campo}\`: ${detalhe}`);
  }
}

function lista(valor: unknown, campo: string, teto: number): unknown[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    throw new RedeInvalidaError(campo, 'esperava lista');
  }
  if (valor.length > teto) {
    throw new RedeInvalidaError(
      campo,
      `${valor.length} itens passam do teto de ${teto}`,
    );
  }
  return valor;
}

function porta(n: unknown, campo: string, minimo: number): number {
  if (
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < minimo ||
    n > 65535
  ) {
    throw new RedeInvalidaError(campo, `esperava inteiro de ${minimo} a 65535`);
  }
  return n;
}

/** Lança `RedeInvalidaError` nomeando o campo; devolve a rede normalizada. */
export function validarRedeDoContainer(entrada: unknown): RedeDoContainer {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const vistos = new Set<number>();
  const ports = lista(e.ports, 'ports', TETO_DE_PORTAS).map((item, i) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const host = porta(p.host, `ports[${i}].host`, 1024);
    const container = porta(p.container, `ports[${i}].container`, 1);
    if (p.protocol !== 'tcp') {
      throw new RedeInvalidaError(`ports[${i}].protocol`, 'só existe `tcp`');
    }
    if (PORTAS_DA_INSTALACAO.includes(host)) {
      throw new RedeInvalidaError(
        `ports[${i}].host`,
        `${host} é porta da instalação do Brabo`,
      );
    }
    if (vistos.has(host)) {
      throw new RedeInvalidaError(
        `ports[${i}].host`,
        `${host} aparece duas vezes`,
      );
    }
    vistos.add(host);
    return { host, container, protocol: 'tcp' as const };
  });

  const dns = lista(e.dns, 'dns', TETO_DE_DNS).map((ip, i) => {
    if (typeof ip !== 'string' || isIP(ip) === 0) {
      throw new RedeInvalidaError(`dns[${i}]`, 'esperava IP literal');
    }
    return ip;
  });

  const extraHosts = lista(
    e.extraHosts,
    'extraHosts',
    TETO_DE_HOSTS_EXTRAS,
  ).map((item, i) => {
    const h = (item ?? {}) as Record<string, unknown>;
    const name = h.name;
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 253 ||
      !/^[a-z0-9.-]+$/.test(name) ||
      /^[.-]|[.-]$|\.\./.test(name)
    ) {
      throw new RedeInvalidaError(`extraHosts[${i}].name`, 'nome inválido');
    }
    if (NOMES_RESERVADOS.includes(name) || name.startsWith('brabo')) {
      throw new RedeInvalidaError(
        `extraHosts[${i}].name`,
        `${name} é reservado (loopback ou serviço da instalação)`,
      );
    }
    if (typeof h.ip !== 'string' || isIP(h.ip) !== 4) {
      throw new RedeInvalidaError(
        `extraHosts[${i}].ip`,
        'esperava IPv4 literal',
      );
    }
    return { name, ip: h.ip };
  });

  return { ports, dns, extraHosts };
}

export function versaoDoPayload(payload: unknown): number {
  const v = (payload as { version?: unknown } | null)?.version;
  return typeof v === 'number' && Number.isInteger(v) ? v : 0;
}
