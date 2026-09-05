import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ObterSpecDeContainerUseCase } from '../../../../src/application/use-cases/containers/obter-spec-de-container.use-case';
import { ObterEstadoObservadoDoContainerUseCase } from '../../../../src/application/use-cases/containers/obter-estado-observado-do-container.use-case';
import type { ObterContainerDoProjetoUseCase } from '../../../../src/application/use-cases/containers/obter-container-do-projeto.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ObservacaoDeContainer,
} from '../../../../src/application/ports/container-broker.port';
import {
  RECURSOS_PADRAO,
  SEM_DECISAO,
  type EstadoDoContainer,
} from '../../../../src/domain/containers/project-container';
import type { Project } from '../../../../src/domain/iam/project.entity';

const PROJETO = 'proj-1';

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO,
    workspaceId: 'ws-1',
    name: 'Projeto',
    slug: 'projeto',
    workspaceDirName: 'projeto-abcdefgh',
    executionMode: 'container',
    workspacePath: null,
    workspaceVerifiedAt: null,
    createdBy: 'user-1',
    taskBudgetMicros: null,
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

const DECIDIDO: EstadoDoContainer = {
  status: 'decidido',
  decisao: {
    image: 'node:22-bookworm-slim',
    rationale: 'O module_map inteiro é TypeScript sobre Node.',
    network: 'egress',
    resources: RECURSOS_PADRAO,
  },
  version: 3,
  eventId: 'evt-1',
  decidedAt: '2026-08-02T00:00:00Z',
};

function montarSpec(
  project: Project | null,
  estado: EstadoDoContainer,
): ObterSpecDeContainerUseCase {
  const projects = {
    findById: async () => project,
  } as unknown as ProjectRepository;
  const obterImagem = {
    execute: async () => estado,
  } as unknown as ObterContainerDoProjetoUseCase;
  return new ObterSpecDeContainerUseCase(projects, obterImagem);
}

describe('ObterSpecDeContainerUseCase — o que o broker lê', () => {
  it('devolve identidade, modo e a decisão vigente do Arquiteto', async () => {
    const resultado = await montarSpec(projeto(), DECIDIDO).execute(PROJETO);

    expect(resultado).toEqual({
      projectId: PROJETO,
      projectSlug: 'projeto',
      workspaceId: 'ws-1',
      workspaceDirName: 'projeto-abcdefgh',
      executionMode: 'container',
      localizacao: { tipo: 'gerenciada', segmento: 'projeto-abcdefgh' },
      imagem: {
        image: 'node:22-bookworm-slim',
        network: 'egress',
        resources: RECURSOS_PADRAO,
      },
      imagemVersao: 3,
    });
  });

  it('NÃO devolve caminho nenhum — nem workspacePath, nem raiz gerenciada', async () => {
    // O `-v` é resolvido pelo DAEMON, contra o filesystem do HOST. Um caminho
    // de dentro do container da api faria o daemon criar e montar uma pasta
    // VAZIA, e ninguém saberia por quê. Quem sabe o caminho de host é o broker.
    const resultado = await montarSpec(
      projeto({ workspacePath: '/home/alguem/dev/projeto' }),
      DECIDIDO,
    ).execute(PROJETO);

    const chaves = Object.keys(resultado);
    expect(chaves).not.toContain('workspacePath');
    expect(chaves).not.toContain('raizDoProjeto');
    expect(JSON.stringify(resultado)).not.toContain('/home/alguem');
  });

  it('não devolve `rationale` — ele existe para um humano revisar, não para o daemon', async () => {
    const resultado = await montarSpec(projeto(), DECIDIDO).execute(PROJETO);

    expect(JSON.stringify(resultado)).not.toContain('module_map');
  });

  it('sem decisão do Arquiteto, `imagem` é null e a versão é 0 (RN-105)', async () => {
    const resultado = await montarSpec(projeto(), SEM_DECISAO).execute(PROJETO);

    expect(resultado.imagem).toBeNull();
    expect(resultado.imagemVersao).toBe(0);
  });

  it('projeto inexistente é 404, não uma spec vazia', async () => {
    await expect(
      montarSpec(null, SEM_DECISAO).execute(PROJETO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ObterSpecDeContainerUseCase — o localizador discriminado (RN-503)', () => {
  const BASE = '/home/voce/brabo';

  beforeEach(() => {
    process.env.BRABO_PROJECTS_BASE = BASE;
  });
  afterEach(() => {
    delete process.env.BRABO_PROJECTS_BASE;
  });

  it('`mounted` sob a base vira `montada` com o segmento RELATIVO, nunca o absoluto', async () => {
    const resultado = await montarSpec(
      projeto({ executionMode: 'mounted', workspacePath: `${BASE}/loja` }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao).toEqual({
      tipo: 'montada',
      segmento: 'loja',
    });
    // O invariante do ADR 0130 em uma linha: nada de absoluto atravessa.
    expect(JSON.stringify(resultado)).not.toContain(BASE);
  });

  it('segmento com mais de um nível continua relativo', async () => {
    const resultado = await montarSpec(
      projeto({
        executionMode: 'mounted',
        workspacePath: `${BASE}/times/loja/`,
      }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao).toEqual({
      tipo: 'montada',
      segmento: 'times/loja',
    });
  });

  it('`container` continua `gerenciada`, com o workspaceDirName como segmento', async () => {
    const resultado = await montarSpec(projeto(), DECIDIDO).execute(PROJETO);

    expect(resultado.localizacao).toEqual({
      tipo: 'gerenciada',
      segmento: 'projeto-abcdefgh',
    });
  });

  it('`runner` é `indisponivel` e o motivo NOMEIA o modo — nenhuma raiz do servidor alcança', async () => {
    const resultado = await montarSpec(
      projeto({ executionMode: 'runner', workspacePath: `${BASE}/loja` }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao.tipo).toBe('indisponivel');
    expect((resultado.localizacao as { motivo: string }).motivo).toContain(
      'runner',
    );
  });

  it('`mounted` FORA da base é `indisponivel` — e o motivo nomeia a base, não o modo', async () => {
    // O projeto legado, criado antes do ADR 0141. O conserto é mover a pasta,
    // não trocar de modo: a mensagem tem de mandar a pessoa para o lugar certo.
    const resultado = await montarSpec(
      projeto({ executionMode: 'mounted', workspacePath: '/opt/legado' }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao.tipo).toBe('indisponivel');
    const motivo = (resultado.localizacao as { motivo: string }).motivo;
    expect(motivo).toContain('/opt/legado');
    expect(motivo).toContain(BASE);
  });

  it('a armadilha de prefixo: /home/voce/brabo2 NÃO está dentro de /home/voce/brabo', async () => {
    const resultado = await montarSpec(
      projeto({ executionMode: 'mounted', workspacePath: '/home/voce/brabo2' }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao.tipo).toBe('indisponivel');
  });

  it('a pasta que É a própria base é recusada, nunca segmento vazio', async () => {
    // Segmento vazio viraria `<raiz>/`, isto é, a base INTEIRA montada no
    // container de um projeto só — a pasta de todos os outros junto.
    const resultado = await montarSpec(
      projeto({ executionMode: 'mounted', workspacePath: BASE }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao.tipo).toBe('indisponivel');
    expect((resultado.localizacao as { motivo: string }).motivo).toContain(
      'base',
    );
  });

  it('sem BRABO_PROJECTS_BASE, `mounted` é `indisponivel` nomeando a variável', async () => {
    delete process.env.BRABO_PROJECTS_BASE;

    const resultado = await montarSpec(
      projeto({
        executionMode: 'mounted',
        workspacePath: '/home/voce/brabo/loja',
      }),
      DECIDIDO,
    ).execute(PROJETO);

    expect(resultado.localizacao.tipo).toBe('indisponivel');
    expect((resultado.localizacao as { motivo: string }).motivo).toContain(
      'BRABO_PROJECTS_BASE',
    );
  });
});

const OBSERVACAO: ObservacaoDeContainer = {
  containerId: 'c0ffee',
  nome: 'brabo-projeto-abcdefgh',
  estado: 'running',
  imagem: 'node:22-bookworm-slim',
  iniciadoEm: '2026-09-01T10:00:00Z',
};

function brokerDeTeste(
  overrides: Partial<{
    configurado: boolean;
    resultado: ObservacaoDeContainer | null;
    erro: Error;
  }> = {},
): ContainerBrokerPort {
  return {
    configurado: () => overrides.configurado ?? true,
    inspect: async () => {
      if (overrides.erro !== undefined) throw overrides.erro;
      return overrides.resultado ?? null;
    },
  } as unknown as ContainerBrokerPort;
}

describe('ObterEstadoObservadoDoContainerUseCase — observado nunca herda registrado', () => {
  it('devolve o que o daemon reportou, sem motivo de não-observação', async () => {
    const caso = new ObterEstadoObservadoDoContainerUseCase(
      brokerDeTeste({ resultado: OBSERVACAO }),
    );

    expect(await caso.execute(PROJETO)).toEqual({
      observado: OBSERVACAO,
      naoObservado: null,
      detalhe: null,
    });
  });

  it('separa "olhei e não há container" de "não consegui olhar"', async () => {
    // As duas devolvem `observado: null`, e é `naoObservado` que as distingue.
    // Colapsá-las é exatamente o que a RN-468 proíbe.
    const olhou = new ObterEstadoObservadoDoContainerUseCase(
      brokerDeTeste({ resultado: null }),
    );
    const naoOlhou = new ObterEstadoObservadoDoContainerUseCase(
      brokerDeTeste({
        erro: new BrokerIndisponivelError('sem-resposta', 'ECONNREFUSED'),
      }),
    );

    expect(await olhou.execute(PROJETO)).toMatchObject({
      observado: null,
      naoObservado: null,
    });
    expect(await naoOlhou.execute(PROJETO)).toMatchObject({
      observado: null,
      naoObservado: 'broker-sem-resposta',
    });
  });

  it('sem BROKER_URL, declara a ausência e nem chama o broker', async () => {
    let chamou = false;
    const broker = {
      configurado: () => false,
      inspect: async () => {
        chamou = true;
        return null;
      },
    } as unknown as ContainerBrokerPort;

    const resultado = await new ObterEstadoObservadoDoContainerUseCase(
      broker,
    ).execute(PROJETO);

    expect(resultado.naoObservado).toBe('broker-nao-configurado');
    expect(chamou).toBe(false);
  });

  it('recusa do broker vira motivo com detalhe, nunca exceção que derrube a leitura', async () => {
    // O ciclo de vida REGISTRADO é informação legítima por si só e existia
    // antes do broker: perdê-lo porque o broker recusou trocaria um dado que
    // temos por um que não temos.
    const caso = new ObterEstadoObservadoDoContainerUseCase(
      brokerDeTeste({
        erro: new BrokerRecusouError(
          409,
          'projeto no modo "runner"',
          'politica',
        ),
      }),
    );

    expect(await caso.execute(PROJETO)).toEqual({
      observado: null,
      naoObservado: 'broker-recusou',
      detalhe: 'projeto no modo "runner"',
    });
  });
});
