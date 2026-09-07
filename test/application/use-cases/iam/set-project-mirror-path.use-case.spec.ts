import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SetProjectMirrorPathUseCase } from '../../../../src/application/use-cases/iam/set-project-mirror-path.use-case';
import type {
  ProjectInput,
  ProjectRepository,
} from '../../../../src/application/ports/project-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';

/**
 * O destino do espelho é declarado pelo usuário, por PROJETO (RN-515, ADR
 * 0147 ponto 4).
 *
 * O que este arquivo prova é a metade A da capacidade `espelho`: onde o
 * destino MORA e o que a api aceita como destino. **Nada aqui copia arquivo
 * nenhum** — a cópia, o `mirror_sync` e a segunda passada de `realpath` são do
 * runner, e o comentário do caso de uso diz por que a api não pode fazê-las.
 */

const PROJETO = 'proj-1';
const ORIGEM = '/tmp/brabo-espelho-teste/base';

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO,
    workspaceId: 'ws-1',
    name: 'Projeto',
    slug: 'projeto',
    workspaceDirName: 'projeto-abcdefgh',
    executionMode: 'mounted',
    workspacePath: ORIGEM,
    workspaceVerifiedAt: null,
    mirrorPath: null,
    createdBy: 'user-1',
    taskBudgetMicros: null,
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

/** Repositório falso com um "banco" em memória de UMA linha. */
function projectRepo(inicial: Project | null) {
  let atual = inicial;
  const updates: Partial<ProjectInput>[] = [];
  const repo: ProjectRepository = {
    findById: () => Promise.resolve(atual),
    update: (_id: string, input: Partial<ProjectInput>) => {
      updates.push(input);
      atual = atual ? { ...atual, ...input, updatedAt: new Date() } : null;
      return Promise.resolve(atual);
    },
  } as unknown as ProjectRepository;
  return { repo, updates };
}

function useCase(inicial: Project | null) {
  const { repo, updates } = projectRepo(inicial);
  return { uc: new SetProjectMirrorPathUseCase(repo), updates };
}

describe('SetProjectMirrorPathUseCase (RN-515)', () => {
  describe('caminho feliz', () => {
    it('grava o destino declarado pelo usuário num projeto mounted', async () => {
      const { uc, updates } = useCase(projeto());

      const resultado = await uc.execute(PROJETO, {
        mirrorPath: '/tmp/brabo-espelho-teste/destino',
      });

      expect(resultado.mirrorPath).toBe('/tmp/brabo-espelho-teste/destino');
      expect(updates).toEqual([
        { mirrorPath: '/tmp/brabo-espelho-teste/destino' },
      ]);
    });

    it('grava também em projeto runner — os dois modos com pasta do usuário podem', async () => {
      const { uc } = useCase(projeto({ executionMode: 'runner' }));

      const resultado = await uc.execute(PROJETO, {
        mirrorPath: '/tmp/brabo-espelho-teste/destino',
      });

      expect(resultado.mirrorPath).toBe('/tmp/brabo-espelho-teste/destino');
    });

    it('grava o caminho NORMALIZADO, nunca a string crua que chegou', async () => {
      const { uc, updates } = useCase(projeto());

      await uc.execute(PROJETO, {
        mirrorPath: '/tmp/brabo-espelho-teste//destino/',
      });

      expect(updates).toEqual([
        { mirrorPath: '/tmp/brabo-espelho-teste/destino' },
      ]);
    });

    it('limpa o destino com null — e isso é o estado NORMAL, não um erro', async () => {
      const { uc, updates } = useCase(
        projeto({ mirrorPath: '/tmp/brabo-espelho-teste/destino' }),
      );

      const resultado = await uc.execute(PROJETO, { mirrorPath: null });

      expect(resultado.mirrorPath).toBeNull();
      expect(updates).toEqual([{ mirrorPath: null }]);
    });

    it('limpar funciona MESMO num projeto container — senão uma linha convertida ficaria presa no estado que a regra proíbe', async () => {
      const { uc, updates } = useCase(
        projeto({
          executionMode: 'container',
          workspacePath: null,
          mirrorPath: '/tmp/brabo-espelho-teste/destino',
        }),
      );

      const resultado = await uc.execute(PROJETO, { mirrorPath: null });

      expect(resultado.mirrorPath).toBeNull();
      expect(updates).toEqual([{ mirrorPath: null }]);
    });

    it('destino igual ao de hoje não grava nada', async () => {
      const { uc, updates } = useCase(
        projeto({ mirrorPath: '/tmp/brabo-espelho-teste/destino' }),
      );

      await uc.execute(PROJETO, {
        mirrorPath: '/tmp/brabo-espelho-teste/destino',
      });

      expect(updates).toEqual([]);
    });
  });

  describe('só o LÉXICO, e a api diz que é só o léxico', () => {
    it('recusa caminho não-absoluto', async () => {
      const { uc, updates } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: 'espelhos/loja' }),
      ).rejects.toThrow(BadRequestException);
      expect(updates).toEqual([]);
    });

    it('recusa caminho com ".." em vez de resolvê-lo', async () => {
      const { uc } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: '/tmp/brabo-espelho-teste/../etc' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa a raiz e pasta de sistema', async () => {
      const { uc } = useCase(projeto());

      await expect(uc.execute(PROJETO, { mirrorPath: '/' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        uc.execute(PROJETO, { mirrorPath: '/etc/brabo' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa caminho sobreposto ao checkout do próprio Brabo', async () => {
      const { uc } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: `${process.cwd()}/espelho` }),
      ).rejects.toThrow(BadRequestException);
    });

    it('a mensagem DIZ que o disco não foi verificado — a api não enxerga a máquina do destino', async () => {
      const { uc } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: 'relativo' }),
      ).rejects.toThrow(/disco NÃO é verificado aqui/);
    });
  });

  describe('os dois sentidos do laço origem↔destino (ADR 0147 ponto 2)', () => {
    it('recusa destino DENTRO do workspacePath — o espelho copiaria o próprio espelho', async () => {
      const { uc, updates } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: `${ORIGEM}/espelho` }),
      ).rejects.toThrow(/DENTRO da pasta do projeto/);
      expect(updates).toEqual([]);
    });

    it('recusa destino IGUAL ao workspacePath — o mesmo laço, no caso degenerado', async () => {
      const { uc } = useCase(projeto());

      await expect(uc.execute(PROJETO, { mirrorPath: ORIGEM })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa destino que CONTÉM o workspacePath — o laço no sentido contrário', async () => {
      const { uc, updates } = useCase(projeto());

      await expect(
        uc.execute(PROJETO, { mirrorPath: '/tmp/brabo-espelho-teste' }),
      ).rejects.toThrow(/CONTÉM a pasta do projeto/);
      expect(updates).toEqual([]);
    });

    it('a comparação é por SEGMENTO: `/base-outra` NÃO está dentro de `/base`', async () => {
      const { uc, updates } = useCase(projeto());

      // `startsWith` cru recusaria este caminho, e recusaria errado: a pasta
      // irmã do projeto é um destino perfeitamente legítimo.
      const resultado = await uc.execute(PROJETO, {
        mirrorPath: `${ORIGEM}-outra`,
      });

      expect(resultado.mirrorPath).toBe(`${ORIGEM}-outra`);
      expect(updates).toEqual([{ mirrorPath: `${ORIGEM}-outra` }]);
    });
  });

  describe('recusas próprias', () => {
    it('recusa NOMEANDO o motivo num projeto container — a origem é um volume do servidor', async () => {
      const { uc, updates } = useCase(
        projeto({ executionMode: 'container', workspacePath: null }),
      );

      await expect(
        uc.execute(PROJETO, { mirrorPath: '/tmp/brabo-espelho-teste/destino' }),
      ).rejects.toThrow(/modo "container" não pode ter destino de espelho/);
      expect(updates).toEqual([]);
    });

    it('projeto inexistente é 404, nunca uma linha gravada no vazio', async () => {
      const { uc, updates } = useCase(null);

      await expect(
        uc.execute(PROJETO, { mirrorPath: '/tmp/brabo-espelho-teste/destino' }),
      ).rejects.toThrow(NotFoundException);
      expect(updates).toEqual([]);
    });
  });
});
