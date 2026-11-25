import { Injectable, Logger } from '@nestjs/common';
import { ContainerBrokerPort } from '../../ports/container-broker.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { stackQueBaixaDependencias } from '../../../domain/containers/project-container';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from './obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from './registrar-transicao-de-container.use-case';

export type ProvaDeRede =
  | { ok: true; nota: string | null; provada: boolean }
  | { ok: false; motivo: string };

// prettier-ignore
const REGISTRY_POR_TERMO: Readonly<Record<string, string>> = {
  node: 'registry.npmjs.org', nodejs: 'registry.npmjs.org', npm: 'registry.npmjs.org',
  pnpm: 'registry.npmjs.org', yarn: 'registry.npmjs.org', bun: 'registry.npmjs.org',
  deno: 'registry.npmjs.org',
  python: 'pypi.org', pip: 'pypi.org', poetry: 'pypi.org', uv: 'pypi.org',
  elixir: 'hex.pm', mix: 'hex.pm', phoenix: 'hex.pm', erlang: 'hex.pm',
  go: 'proxy.golang.org', golang: 'proxy.golang.org',
  rust: 'crates.io', cargo: 'crates.io',
  ruby: 'rubygems.org', bundler: 'rubygems.org', rails: 'rubygems.org',
  java: 'repo.maven.apache.org', maven: 'repo.maven.apache.org',
  gradle: 'repo.maven.apache.org', kotlin: 'repo.maven.apache.org',
  php: 'packagist.org', composer: 'packagist.org',
  dotnet: 'api.nuget.org', nuget: 'api.nuget.org',
};

/** O registry do ecossistema da stack (lista da RN-906); sem ecossistema, `github.com`. */
export function registryDaStack(termo: string | null): string {
  return (termo && REGISTRY_POR_TERMO[termo]) || 'github.com';
}

/**
 * RN-1366: com postura `egress`, a api só registra `running` depois de provar
 * o DNS de dentro do container (AT-980/L2). Saída 127 (a imagem não tem
 * `getent` nem `nslookup`) não prova nem reprova: segue com a nota "rede não
 * provada". Reprovou: remove o container e marca o ciclo `failed`, para o dev
 * não reivindicar a tarefa sem rede (RN-502). Ciclo `running` que reprova
 * (`start` idempotente sobre container de pé) vira `failed` SEM remover o container (RN-1384). Postura `none` não prova nada.
 */
@Injectable()
export class ProvarRedeDoContainerUseCase {
  private readonly logger = new Logger(ProvarRedeDoContainerUseCase.name);

  constructor(
    private readonly brokerPort: ContainerBrokerPort,
    private readonly obterContainer: ObterContainerDoProjetoUseCase,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
  ) {}

  async execute(projectId: string): Promise<ProvaDeRede> {
    const ciclo = await this.obterCicloDeVida.execute(projectId);
    const estado = await this.obterContainer.execute(projectId);
    if (estado.decisao?.network !== 'egress') {
      return { ok: true, nota: null, provada: false };
    }

    const mapa = await this.moduleMaps.findCurrent(projectId);
    const registry = registryDaStack(
      stackQueBaixaDependencias(mapa?.modules ?? [])?.termo ?? null,
    );
    const r = await this.brokerPort.exec(
      projectId,
      `if command -v getent >/dev/null 2>&1; then getent hosts ${registry}; ` +
        `elif command -v nslookup >/dev/null 2>&1; then nslookup ${registry}; ` +
        'else exit 127; fi',
      undefined,
      15_000,
    );
    if (r.exitCode === 0) return { ok: true, nota: null, provada: true };
    if (r.exitCode === 127) {
      const nota = 'rede não provada: a imagem não tem getent/nslookup';
      this.logger.warn(`projeto ${projectId}: ${nota}`);
      return { ok: true, nota, provada: false };
    }

    const motivo = `o container subiu sem rede: DNS de ${registry} falhou${
      r.timedOut ? ' (tempo esgotado)' : ` (saída ${r.exitCode})`
    }.`;
    // Container de pé (`start` idempotente): marca `failed` e avisa, mas não derruba.
    if (ciclo?.status === 'running') {
      this.logger.warn(`projeto ${projectId}: ${motivo}`);
    } else {
      await this.brokerPort.remove(projectId);
    }
    if (
      ciclo &&
      ['provisioning', 'running', 'stopped'].includes(ciclo.status)
    ) {
      await this.registrarTransicao.execute(projectId, 'failed', {
        failureReason: motivo,
      });
    }
    return { ok: false, motivo };
  }
}
