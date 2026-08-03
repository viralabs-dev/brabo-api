import type { GitProviderName } from '@brabo/shared';

// Erros normalizados das 10 operações do GitProviderContract (ver
// docs/adr/0002) — cada um é uma classe avulsa com campos de contexto
// tipados, mesmo padrão já usado em git-provider-errors.ts (OAuth) e no
// resto do domínio. Deliberadamente sem classe-base comum: nenhum filtro
// HTTP novo é registrado nesta sessão (não há endpoint ainda expondo
// essas operações), então uma base compartilhada não teria uso imediato.
//
// Eram 8 quando o arquivo nasceu; `getFileContent` (bootstrap idempotente) e
// `commentOnPullRequest` (gates de PR, Fase 4a) entraram depois e o número
// aqui não acompanhou — achado #7 do primeiro dogfooding. A contagem é
// travada por teste: ver test/domain/git/git-errors.spec.ts.
//
// A última classe do arquivo, `GitCredentialConnectionTestFailedError`, NÃO
// pertence às operações do contrato: é do teste de conexão de credencial
// (Fase 2, ADR 0004) e mora aqui por proximidade de assunto.

export class GitRepoAlreadyExistsError extends Error {
  constructor(readonly repoId: string) {
    super(`repositório já existe: ${repoId}`);
    this.name = 'GitRepoAlreadyExistsError';
  }
}

export class GitRepoNotFoundError extends Error {
  constructor(readonly repoId: string) {
    super(`repositório não encontrado: ${repoId}`);
    this.name = 'GitRepoNotFoundError';
  }
}

export class GitBranchNotFoundError extends Error {
  constructor(
    readonly repoId: string,
    readonly ref: string,
  ) {
    super(`branch/ref não encontrada: ${ref}`);
    this.name = 'GitBranchNotFoundError';
  }
}

export class GitBranchAlreadyExistsError extends Error {
  constructor(
    readonly repoId: string,
    readonly branchName: string,
  ) {
    super(`branch já existe: ${branchName}`);
    this.name = 'GitBranchAlreadyExistsError';
  }
}

export class GitPermissionDeniedError extends Error {
  constructor(readonly path: string) {
    super(`permissão negada: ${path}`);
    this.name = 'GitPermissionDeniedError';
  }
}

export class GitNotSupportedError extends Error {
  constructor(
    readonly provider: GitProviderName,
    readonly operation: string,
  ) {
    super(`${provider} não suporta a operação: ${operation}`);
    this.name = 'GitNotSupportedError';
  }
}

// Sessão 2 (ver docs/adr/0004-git-credential-registration.md): falha no
// teste de conexão de uma credencial de git antes de persistir — nunca
// lançado depois de gravar nada.
export class GitCredentialConnectionTestFailedError extends Error {
  constructor(
    readonly provider: GitProviderName,
    readonly reason?: string,
  ) {
    super(
      `teste de conexão falhou para ${provider}${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'GitCredentialConnectionTestFailedError';
  }
}
