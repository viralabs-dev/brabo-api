import { describe, expect, it } from 'vitest';
import {
  C4DiagramaInvalidoError,
  gerarDiagramaContainer,
  gerarDiagramaContexto,
  validarEntradaC4,
} from '../../../src/domain/architecture/c4-diagram';
import type { ModuleNode } from '../../../src/domain/architecture/module-graph';

function modulos(): ModuleNode[] {
  return [
    {
      name: 'saudacao',
      stack: 'ts',
      responsibility: 'regra da saudação',
      dependsOn: [],
    },
    {
      name: 'api_http',
      stack: 'ts',
      responsibility: 'endpoint público',
      dependsOn: ['saudacao'],
    },
  ];
}

describe('validarEntradaC4', () => {
  it('recusa sem system_name', () => {
    expect(() => validarEntradaC4({})).toThrow(C4DiagramaInvalidoError);
  });

  it('recusa system_name em branco', () => {
    expect(() => validarEntradaC4({ systemName: '   ' })).toThrow(
      /system_name/,
    );
  });

  it('aceita sem atores — lista vazia', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    expect(entrada.actors).toEqual([]);
    expect(entrada.systemDescription).toBe('');
  });

  it('ator sem name é recusado com o índice', () => {
    expect(() =>
      validarEntradaC4({
        systemName: 'Brabo',
        actors: [{ description: 'sem nome' }],
      }),
    ).toThrow(/actors\[0\]\.name/);
  });

  it('type default é "person"', () => {
    const entrada = validarEntradaC4({
      systemName: 'Brabo',
      actors: [{ name: 'Usuário' }],
    });
    expect(entrada.actors[0].type).toBe('person');
  });

  it('type inválido é recusado', () => {
    expect(() =>
      validarEntradaC4({
        systemName: 'Brabo',
        actors: [{ name: 'GitHub', type: 'robo' }],
      }),
    ).toThrow(/actors\[0\]\.type/);
  });

  it('type "external_system" é aceito', () => {
    const entrada = validarEntradaC4({
      systemName: 'Brabo',
      actors: [{ name: 'GitHub', type: 'external_system' }],
    });
    expect(entrada.actors[0].type).toBe('external_system');
  });
});

describe('gerarDiagramaContexto', () => {
  it('produz um diagrama C4Context com o sistema e os atores', () => {
    const entrada = validarEntradaC4({
      systemName: 'Brabo',
      systemDescription: 'Plataforma de agentes',
      actors: [
        { name: 'Usuário', description: 'Opera o produto' },
        {
          name: 'GitHub',
          type: 'external_system',
          description: 'Hospeda o código',
        },
      ],
    });

    const diagrama = gerarDiagramaContexto(entrada);

    expect(diagrama).toMatch(/^C4Context/);
    expect(diagrama).toContain('System(');
    expect(diagrama).toContain('"Brabo"');
    expect(diagrama).toContain('Person(');
    expect(diagrama).toContain('"Usuário"');
    expect(diagrama).toContain('System_Ext(');
    expect(diagrama).toContain('"GitHub"');
    // Um Rel por ator, todos apontando pro sistema.
    expect(diagrama.match(/Rel\(/g)).toHaveLength(2);
  });

  it('nomes com aspas não quebram a sintaxe — a aspa vira simples', () => {
    const entrada = validarEntradaC4({
      systemName: 'Sistema "principal"',
      actors: [{ name: 'Usuário "admin"' }],
    });

    const diagrama = gerarDiagramaContexto(entrada);
    expect(diagrama).toContain("Sistema 'principal'");
    expect(diagrama).toContain("Usuário 'admin'");
    // Nenhuma aspa dupla sobra DENTRO de um label (só as delimitadoras do
    // Mermaid, em pares abrindo/fechando cada string).
    expect(diagrama.match(/"/g)!.length % 2).toBe(0);
  });

  it('atores com o mesmo nome (case-insensitive) recebem ids distintos', () => {
    const entrada = validarEntradaC4({
      systemName: 'Brabo',
      actors: [{ name: 'API' }, { name: 'api' }],
    });

    const diagrama = gerarDiagramaContexto(entrada);
    const ids = [...diagrama.matchAll(/Person\((\w+),/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it('sem atores, ainda produz um diagrama válido só com o sistema', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    const diagrama = gerarDiagramaContexto(entrada);
    expect(diagrama).toContain('System(');
    expect(diagrama).not.toContain('Rel(');
  });
});

describe('gerarDiagramaContainer', () => {
  it('produz um diagrama C4Container com um Container por módulo', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    const diagrama = gerarDiagramaContainer(entrada, modulos());

    expect(diagrama).toMatch(/^C4Container/);
    expect(diagrama).toContain('System_Boundary(');
    expect(diagrama).toContain('Container(');
    expect(diagrama.match(/Container\(/g)).toHaveLength(2);
    expect(diagrama).toContain('"saudacao"');
    expect(diagrama).toContain('"api_http"');
  });

  it('as dependências do module_map viram Rel entre os containers', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    const diagrama = gerarDiagramaContainer(entrada, modulos());

    expect(diagrama.match(/Rel\(/g)).toHaveLength(1);
    expect(diagrama).toContain('"depende de"');
  });

  it('aresta para módulo inexistente é ignorada, sem quebrar o diagrama', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    const comAresta_pendurada: ModuleNode[] = [
      { name: 'a', stack: 'ts', responsibility: 'a', dependsOn: ['sumiu'] },
    ];

    const diagrama = gerarDiagramaContainer(entrada, comAresta_pendurada);
    expect(diagrama).not.toContain('Rel(');
  });

  it('module_map sem módulos ainda produz um boundary com placeholder', () => {
    const entrada = validarEntradaC4({ systemName: 'Brabo' });
    const diagrama = gerarDiagramaContainer(entrada, []);

    expect(diagrama).toContain('System_Boundary(');
    expect(diagrama).toContain('Nenhum módulo definido');
  });
});
