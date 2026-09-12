import { describe, it, expect, vi } from 'vitest';
import { ListRunnerDeviceKeysUseCase } from '../../../../src/application/use-cases/auth/list-runner-device-keys.use-case';
import type {
  ChaveDeDispositivoResumo,
  RunnerDeviceKeyRepository,
} from '../../../../src/application/ports/runner-device-key-repository.port';

const ORFA: ChaveDeDispositivoResumo = {
  id: 'device-orfa',
  name: 'laptop',
  projectId: 'proj-1',
  especie: 'projeto',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  revokedAt: null,
  lastUsedAt: null,
};

/** A de MÁQUINA serve este projeto sem pertencer a ele (RN-543). */
const DE_MAQUINA: ChaveDeDispositivoResumo = {
  ...ORFA,
  id: 'device-maquina',
  name: 'desktop',
  projectId: null,
  especie: 'maquina',
};

const REVOGADA = {
  ...ORFA,
  id: 'device-revogada',
  revokedAt: new Date('2026-09-02T10:00:00Z'),
  lastUsedAt: new Date('2026-09-01T11:00:00Z'),
};

describe('ListRunnerDeviceKeysUseCase (RN-519)', () => {
  it('caminho feliz: delega ao repositório com userId e projectId, na ordem certa', async () => {
    const listarDoUsuarioNoProjeto = vi.fn(() => Promise.resolve([ORFA]));
    const deviceKeys = {
      listarDoUsuarioNoProjeto,
    } as unknown as RunnerDeviceKeyRepository;

    const resultado = await new ListRunnerDeviceKeysUseCase(deviceKeys).execute(
      'user-1',
      'proj-1',
    );

    expect(listarDoUsuarioNoProjeto).toHaveBeenCalledWith('user-1', 'proj-1');
    expect(resultado).toEqual([ORFA]);
  });

  it('a chave REVOGADA continua na lista — sumir com ela faria a tela afirmar que nunca existiu', async () => {
    const deviceKeys = {
      listarDoUsuarioNoProjeto: vi.fn(() => Promise.resolve([ORFA, REVOGADA])),
    } as unknown as RunnerDeviceKeyRepository;

    const resultado = await new ListRunnerDeviceKeysUseCase(deviceKeys).execute(
      'user-1',
      'proj-1',
    );

    expect(resultado.map((c) => c.id)).toEqual([
      'device-orfa',
      'device-revogada',
    ]);
    // A chave ÓRFÃ é a que nunca foi usada — o sinal que a listagem existe
    // para tornar visível.
    expect(resultado[0].lastUsedAt).toBeNull();
  });

  it('a lista traz as DUAS espécies, e DIZ qual é qual (RN-543)', async () => {
    // "Uma de máquina não é a chave do projeto X" — a consequência que o ADR
    // 0154 declara. Sem a marca, a mesma linha apareceria em N projetos
    // parecendo N chaves diferentes.
    const deviceKeys = {
      listarDoUsuarioNoProjeto: vi.fn(() =>
        Promise.resolve([ORFA, DE_MAQUINA]),
      ),
    } as unknown as RunnerDeviceKeyRepository;

    const resultado = await new ListRunnerDeviceKeysUseCase(deviceKeys).execute(
      'user-1',
      'proj-1',
    );

    expect(resultado.map((c) => c.especie)).toEqual(['projeto', 'maquina']);
    expect(resultado[1].projectId).toBeNull();
  });

  it('caso de falha: repositório que rejeita propaga — a lista não inventa vazio', async () => {
    const deviceKeys = {
      listarDoUsuarioNoProjeto: vi.fn(() =>
        Promise.reject(new Error('banco fora do ar')),
      ),
    } as unknown as RunnerDeviceKeyRepository;

    await expect(
      new ListRunnerDeviceKeysUseCase(deviceKeys).execute('user-1', 'proj-1'),
    ).rejects.toThrow('banco fora do ar');
  });
});
