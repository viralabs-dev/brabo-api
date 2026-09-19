import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { WorkspacesController } from '../../../../src/interfaces/http/iam/workspaces.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { HttpContainerBrokerClient } from '../../../../src/infrastructure/http-clients/container-broker.client';

/**
 * `GET /workspaces/:workspaceId/projects-base` — RN-500, e desde o ADR 0161
 * (RN-573) também `brokerConfigurado`.
 *
 * A pergunta que a rota responde é "que modo esta INSTALAÇÃO consegue
 * executar?", e ela tem duas metades: a base (para `mounted` ter pasta) e o
 * broker (para `container`/`mounted` subirem container, ADR 0144). Sem a
 * segunda, o assistente pré-selecionava `mounted` numa instalação em que
 * nenhum dev agent jamais trabalharia (AT-085).
 *
 * O cliente HTTP de verdade entra aqui, e não um dublê com `configurado`
 * fixo: o que se prova é que a resposta segue `BROKER_URL`, pela MESMA fonte
 * que a leitura do estado observado usa.
 */

const originalBrokerUrl = process.env.BROKER_URL;
const originalBase = process.env.BRABO_PROJECTS_BASE;

afterEach(() => {
  if (originalBrokerUrl === undefined) delete process.env.BROKER_URL;
  else process.env.BROKER_URL = originalBrokerUrl;
  if (originalBase === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = originalBase;
});

function novoController(): WorkspacesController {
  const inerte = { execute: vi.fn() } as never;
  return new WorkspacesController(
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    new HttpContainerBrokerClient(),
  );
}

describe('WorkspacesController — projects-base', () => {
  it('continua exigindo maintainer — o campo novo não abre a rota a ninguém', () => {
    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const handler = WorkspacesController.prototype.getProjectsBase;
    expect(reflector.get(REQUIRED_ROLE_KEY, handler)).toBe('maintainer');
  });

  it('com BROKER_URL definida, `brokerConfigurado: true` ao lado da base', () => {
    process.env.BROKER_URL = 'http://broker:8090';
    process.env.BRABO_PROJECTS_BASE = '/home/voce/brabo';

    expect(novoController().getProjectsBase()).toEqual({
      projectsBase: '/home/voce/brabo',
      brokerConfigurado: true,
    });
  });

  it('sem BROKER_URL (a instalação do AT-085), `false` MESMO com base — base não é broker', () => {
    delete process.env.BROKER_URL;
    process.env.BRABO_PROJECTS_BASE = '/home/voce/brabo';

    expect(novoController().getProjectsBase()).toEqual({
      projectsBase: '/home/voce/brabo',
      brokerConfigurado: false,
    });
  });

  it('BROKER_URL só com espaço conta como ausente', () => {
    process.env.BROKER_URL = '   ';

    expect(novoController().getProjectsBase().brokerConfigurado).toBe(false);
  });
});
