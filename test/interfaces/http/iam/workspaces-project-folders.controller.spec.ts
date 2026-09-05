import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkspacesController } from '../../../../src/interfaces/http/iam/workspaces.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { RolesGuard } from '../../../../src/interfaces/http/iam/roles.guard';

/**
 * `GET /workspaces/:workspaceId/project-folders` — RN-504.
 *
 * Duas perguntas, e elas são diferentes:
 *
 * 1. **quem alcança a rota** — `maintainer`, o mesmo mínimo de
 *    `POST .../projects` e de `.../projects-base`, porque a rota revela a
 *    topologia de arquivos do operador. É o `RolesGuard` que recusa, e este
 *    arquivo o exercita de verdade em vez de só ler o metadado: o teste que
 *    afirma só o decorator passaria mesmo se o guard tivesse a comparação
 *    invertida;
 * 2. **como a recusa do domínio vira status** — fora da base é 400 (pedido
 *    malformado; 403 sugeriria que outro papel veria, e nenhum vê), pasta
 *    ilegível é 404.
 */

let raiz: string;
let base: string;
const originalBase = process.env.BRABO_PROJECTS_BASE;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'brabo-folders-http-'));
  base = join(raiz, 'brabo');
  mkdirSync(join(base, 'loja'), { recursive: true });
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});

afterEach(() => {
  if (originalBase === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = originalBase;
});

/** O controller não recebe nada desta rota — todas as 12 dependências são inertes aqui. */
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
  );
}

/**
 * O handler como METADATA KEY, não como função a chamar.
 *
 * `reflector.get`/`getAllAndOverride` e o `ExecutionContext` do Nest recebem a
 * referência do método só para ler o que os decorators penduraram nele — nunca
 * o invocam. `@typescript-eslint/unbound-method` não distingue os dois usos,
 * então a supressão fica AQUI, com o motivo, em vez de espalhada por cada
 * linha.
 */
/* eslint-disable @typescript-eslint/unbound-method */
const HANDLER = WorkspacesController.prototype.listProjectFolders;

describe('WorkspacesController — project-folders: papel', () => {
  it('exige maintainer — o MESMO mínimo de POST .../projects, nunca o viewer das vizinhas', () => {
    const reflector = new Reflector();
    expect(reflector.get(REQUIRED_ROLE_KEY, HANDLER)).toBe('maintainer');
  });

  it('viewer é recusado pelo RolesGuard; maintainer passa', async () => {
    const reflector = new Reflector();
    const resolveRole = {
      forWorkspace: vi.fn(),
    };
    const guard = new RolesGuard(reflector, resolveRole as never);

    const contexto = () =>
      ({
        getHandler: () => HANDLER,
        getClass: () => WorkspacesController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'u1' },
            params: { workspaceId: 'w1' },
          }),
        }),
      }) as never;

    resolveRole.forWorkspace.mockResolvedValue('viewer');
    await expect(guard.canActivate(contexto())).rejects.toThrow(
      'Papel insuficiente para esta ação',
    );

    resolveRole.forWorkspace.mockResolvedValue('maintainer');
    await expect(guard.canActivate(contexto())).resolves.toBe(true);
  });
});

describe('WorkspacesController — project-folders: status', () => {
  it('lista a base quando `path` é omitido', () => {
    process.env.BRABO_PROJECTS_BASE = base;

    const r = novoController().listProjectFolders();

    expect(r.base).toBe(base);
    expect(r.path).toBe(base);
    expect(r.entries).toContain('loja');
  });

  it('fora da base vira 400 — malformado, e não 403 de permissão', () => {
    process.env.BRABO_PROJECTS_BASE = base;

    expect(() => novoController().listProjectFolders('/etc')).toThrow(
      BadRequestException,
    );
  });

  it('pasta inexistente dentro da base vira 404', () => {
    process.env.BRABO_PROJECTS_BASE = base;

    expect(() =>
      novoController().listProjectFolders(join(base, 'nunca-existiu')),
    ).toThrow(NotFoundException);
  });

  it('sem BRABO_PROJECTS_BASE e sem `path`, responde 200 com `base: null`', () => {
    delete process.env.BRABO_PROJECTS_BASE;

    // É assim que o assistente de criação aprende a esconder o modo Pasta
    // montada: por um 200 que declara a ausência, nunca por um 4xx.
    expect(novoController().listProjectFolders()).toEqual({
      base: null,
      path: null,
      entries: [],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    });
  });
});
