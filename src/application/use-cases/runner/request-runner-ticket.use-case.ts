import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ProjectRepository } from '../../ports/project-repository.port';

/** Os dois papéis que um ticket de `/runner` pode carregar — ver `Engine.Runners.SocketTicket`. */
export type RunnerTicketKind = 'runner' | 'terminal';

export interface RunnerTicketEmitido {
  ticket: string;
  expiresAt: Date;
  /** URL do socket Phoenix `/runner`, já no protocolo ws(s):// — pronta pra `new Socket(...)`. */
  engineWsUrl: string;
}

/**
 * Pede ao engine um ticket opaco de uso único pro socket `/runner`
 * (`EngineWeb.RunnerSocket`/`EngineWeb.TerminalChannel`, tópico
 * `terminal:<projectId>`) — RÉPLICA do padrão RN-108, mas com o dono
 * INVERTIDO: o ticket de sessão (`CreateSocketTicketUseCase`) é gerado E
 * gravado AQUI, direto no banco (Drizzle); este é só PEDIDO ao engine
 * (`ApiToEngineClient.requestRunnerTicket`), que é quem gera e guarda —
 * `runner_socket_tickets` vive no schema "engine", que esta api não escreve.
 *
 * `kind: "runner"` é o CLI na máquina do usuário — só existe pra projeto em
 * modo `runner` (ADR 0104; era `local` antes da reconciliação — RN-421): não
 * faz sentido um runner pra um projeto cujo código mora no container
 * gerenciado, nem para um `mounted`, que já resolve por bind-mount.
 * `kind: "terminal"` é a aba Terminal da web, que pode assistir/interagir em
 * QUALQUER modo (inclusive `container`, onde ela mostra o terminal do
 * container de sempre — o roteamento pro runner em
 * `Engine.Actions.TerminalExecutor` só entra em jogo quando HÁ um runner
 * conectado E o workspace já foi verificado, RN-423).
 */
@Injectable()
export class RequestRunnerTicketUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    kind: RunnerTicketKind,
  ): Promise<RunnerTicketEmitido> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (kind === 'runner' && project.executionMode !== 'runner') {
      throw new BadRequestException(
        'O runner local só pode conectar em projetos no modo "runner" ' +
          `(ADR 0104). Este projeto está no modo "${project.executionMode}", ` +
          'onde o runner não tem papel — em "container" o código roda no ' +
          'container gerenciado, e em "mounted" a pasta já é acessada por ' +
          'bind-mount. Crie o projeto no modo "runner" para conectar um ' +
          'runner.',
      );
    }

    const { ticket, expiresAt } = await this.engine.requestRunnerTicket(
      projectId,
      userId,
      kind,
    );

    return { ticket, expiresAt, engineWsUrl: engineWsUrlPublico() };
  }
}

/**
 * A URL pública (fora do cluster) do socket `/runner` — o runner roda na
 * MÁQUINA DO USUÁRIO, então precisa de um endereço alcançável de fora,
 * diferente do `ENGINE_URL` interno que `ApiToEngineClient` usa pra falar
 * com o engine dentro da rede do produto. `ENGINE_PUBLIC_URL` é NOVO
 * (nenhuma outra rota usava um endereço público de engine até aqui); sem
 * ele, cai pro mesmo default de dev de sempre.
 *
 * Mesma transformação http(s) -> ws(s) que `apps/web/src/lib/session-channel.ts`
 * já faz do lado do browser — replicada aqui porque o runner não é o
 * browser, não lê `runtime-config.ts`.
 */
function engineWsUrlPublico(): string {
  const base =
    process.env.ENGINE_PUBLIC_URL ??
    process.env.ENGINE_URL ??
    'http://localhost:4000';
  return `${base.replace(/^http/, 'ws')}/runner`;
}
