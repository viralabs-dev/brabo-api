import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  PersonalAccessTokenRepository,
  type PatResumo,
} from '../../ports/personal-access-token-repository.port';
import { TokenFactory } from './token-factory';

const PREFIXO = 'brb_';

export interface PatEmitido extends PatResumo {
  /** Bruto — devolvido SÓ nesta chamada, nunca recuperável depois. */
  token: string;
}

/**
 * Emite um Personal Access Token pro runner local (ADR 0105, RN-424).
 *
 * NÃO confere `executionMode === 'runner'` aqui: o token pode ser emitido
 * antes do projeto virar `runner`, e quem revalida o modo na hora de USAR
 * é `RequestRunnerTicketUseCase` — duplicar a checagem na emissão seria
 * dois lugares pra divergir.
 */
@Injectable()
export class IssuePersonalAccessTokenUseCase {
  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly tokenFactory: TokenFactory,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(input: {
    userId: string;
    projectId: string;
    name: string;
    expiresInDays?: number;
  }): Promise<PatEmitido> {
    const project = await this.projects.findById(input.projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // Descarta o `.hash` de `gerar()` — ele é do texto SEM o prefixo `brb_`,
    // e o guard recebe o token INTEIRO do header. Hashear só o sufixo criaria
    // uma assimetria fácil de esquecer entre emissão e validação.
    const { bruto } = this.tokenFactory.gerar();
    const token = `${PREFIXO}${bruto}`;
    const tokenHash = this.tokenFactory.hashDe(token);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const emitido = await this.tokens.emitir({
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      tokenHash,
      expiresAt,
    });

    return { ...emitido, token };
  }
}
