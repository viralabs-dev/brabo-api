import { describe, expect, it } from 'vitest';
import {
  BACKUP_AGE_ATRASADO_SEGUNDOS,
  avaliarBackup,
  formatarIdade,
  lerOpcoes,
} from '../../scripts/relatorio-backup';

/**
 * O relatório de backup/restore do papel `dbre` (docs/fluxo.yml, ADR 0093).
 *
 * `avaliarBackup` é a MESMA leitura de `backup_runs` que
 * `DomainGaugesCollector.collectBackup()` já faz (dois "quadros": último
 * SUCESSO e como terminou a ÚLTIMA execução) — aqui mockada, porque a
 * consulta em si já é exercitada pelo collector.
 */

const AGORA = new Date('2026-08-16T12:00:00Z').getTime();

describe('avaliarBackup', () => {
  it('nunca houve backup: status `nunca_houve`, idade nula', () => {
    const r = avaliarBackup(null, null, AGORA);

    expect(r.status).toBe('nunca_houve');
    expect(r.idadeSegundos).toBeNull();
  });

  it('nunca houve SUCESSO, mas já houve execução (falhou desde sempre)', () => {
    const r = avaliarBackup(null, { status: 'failed' }, AGORA);

    expect(r.status).toBe('nunca_houve');
    expect(r.resumo).toContain('falhou');
  });

  it('backup recente e última execução ok: `ok`', () => {
    const r = avaliarBackup(
      { finishedAt: new Date('2026-08-16T03:17:00Z'), sizeBytes: 1024 },
      { status: 'ok' },
      AGORA,
    );

    expect(r.status).toBe('ok');
    // 12:00 - 03:17 = 8h43min = 31.380s.
    expect(r.idadeSegundos).toBe(31_380);
  });

  it('idade acima do limiar de 26h: `atrasado`', () => {
    const finishedAt = new Date(
      AGORA - (BACKUP_AGE_ATRASADO_SEGUNDOS + 60) * 1000,
    );
    const r = avaliarBackup(
      { finishedAt, sizeBytes: 1024 },
      { status: 'ok' },
      AGORA,
    );

    expect(r.status).toBe('atrasado');
  });

  it('idade exatamente no limiar NÃO conta como atrasado (é `> `, não `>=`)', () => {
    const finishedAt = new Date(
      AGORA - BACKUP_AGE_ATRASADO_SEGUNDOS * 1000,
    );
    const r = avaliarBackup(
      { finishedAt, sizeBytes: 1024 },
      { status: 'ok' },
      AGORA,
    );

    expect(r.status).toBe('ok');
  });

  it('há sucesso recente mas a ÚLTIMA execução falhou: alerta específico, não `ok`', () => {
    const r = avaliarBackup(
      { finishedAt: new Date('2026-08-16T03:17:00Z'), sizeBytes: 1024 },
      { status: 'failed' },
      AGORA,
    );

    expect(r.status).toBe('falha_recente_com_sucesso_antigo');
    expect(r.idadeSegundos).not.toBeNull();
  });

  it('atrasado tem prioridade sobre falha recente quando os dois valem', () => {
    const finishedAt = new Date(
      AGORA - (BACKUP_AGE_ATRASADO_SEGUNDOS + 60) * 1000,
    );
    const r = avaliarBackup(
      { finishedAt, sizeBytes: 1024 },
      { status: 'failed' },
      AGORA,
    );

    expect(r.status).toBe('atrasado');
  });

  it('idade nunca é negativa mesmo com relógio adiantado', () => {
    const r = avaliarBackup(
      { finishedAt: new Date(AGORA + 10_000), sizeBytes: 1024 },
      { status: 'ok' },
      AGORA,
    );

    expect(r.idadeSegundos).toBe(0);
  });
});

describe('formatarIdade', () => {
  it('minutos', () => {
    expect(formatarIdade(90)).toBe('2min');
  });

  it('horas e minutos', () => {
    expect(formatarIdade(3 * 3600 + 5 * 60)).toBe('3h05min');
  });

  it('dias e horas', () => {
    expect(formatarIdade(2 * 86400 + 4 * 3600)).toBe('2d04h');
  });
});

describe('lerOpcoes', () => {
  it('sem argumento: json desligado', () => {
    expect(lerOpcoes([])).toEqual({ json: false });
  });

  it('--json liga a saída em JSON', () => {
    expect(lerOpcoes(['--json'])).toEqual({ json: true });
  });

  it('`--` do pnpm é ignorado', () => {
    expect(lerOpcoes(['--', '--json'])).toEqual({ json: true });
  });

  it('opção desconhecida é uso inválido', () => {
    expect(lerOpcoes(['--turbo'])).toEqual({
      erro: 'opção desconhecida: --turbo',
    });
  });
});
