// O Nest carrega `reflect-metadata` no boot; num spec isolado ele não está
// carregado, e sem ele `Reflect.defineMetadata` não existe. O decorator engole
// isso de propósito (invariante 4), então sem este import o teste de metadata
// passaria afirmando nada.
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Traced } from '../../../src/infrastructure/observability/traced.decorator';
import {
  currentRequestContext,
  runWithRequestContext,
} from '../../../src/infrastructure/observability/request-context';

/**
 * O decorator `@Traced` (ADR 0035).
 *
 * Mesma filosofia de `trace-context.spec.ts`, e aqui ela é ainda mais literal:
 * este decorator substitui o corpo de métodos de caso de uso e de repositório do
 * caminho crítico. O que se protege não é "a span foi criada" — é que
 * **instrumentar não pode mudar comportamento nenhum**.
 *
 * Cada teste abaixo mapeia uma forma concreta de quebrar produção:
 *
 * - `this` perdido → todo `this.repo` de todo caso de uso vira `undefined`;
 * - síncrono virando Promise → quem chama passa a receber Promise sem saber;
 * - erro embrulhado → os exception filters despacham por classe, e um 409 de
 *   domínio viraria 500;
 * - metadata descartada → um `@RequireRole` que desaparece (por isso a regra de
 *   nunca decorar controller, mas a cópia existe de todo jeito).
 *
 * Não há provider de OTel registrado neste arquivo, de propósito: sob o
 * `NoopTracer` o `startActiveSpan` só invoca o callback, o que é exatamente o
 * cenário de teste unitário de quem usar o decorator.
 */

class Repositorio {
  chamadas: string[] = [];

  @Traced('infrastructure')
  gravar(valor: string): string {
    this.chamadas.push(valor);
    return `gravado:${valor}`;
  }
}

class CasoDeUso {
  readonly nome = 'caso';
  readonly repo = new Repositorio();

  @Traced('application')
  sincrono(a: number, b: number): number {
    return a + b;
  }

  @Traced('application')
  async assincrono(valor: string): Promise<{ ok: string }> {
    await Promise.resolve();
    return { ok: valor };
  }

  @Traced('application')
  usaThis(): string {
    // A invariante 1 em forma executável.
    return `${this.nome}:${this.repo.gravar('x')}`;
  }

  @Traced('application')
  levanta(): never {
    throw new TypeError('erro de dominio');
  }

  @Traced('application')
  levantaNaoErro(): never {
    // `throw` de string é legal em JS e aparece em código de terceiros; o
    // decorator precisa sobreviver a ele sem transformar em Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw 'texto cru';
  }

  @Traced('application')
  async rejeita(): Promise<never> {
    await Promise.resolve();
    throw new RangeError('rejeitou');
  }

  @Traced('application')
  composto(): string {
    return this.repo.gravar('aninhado');
  }
}

describe('Traced', () => {
  let caso: CasoDeUso;

  beforeEach(() => {
    caso = new CasoDeUso();
  });

  describe('não altera o comportamento do método', () => {
    it('devolve o mesmo valor', () => {
      expect(caso.sincrono(2, 3)).toBe(5);
    });

    it('preserva `this`', () => {
      // Se o wrapper fosse arrow, `this.nome` seria undefined aqui.
      expect(caso.usaThis()).toBe('caso:gravado:x');
    });

    it('método síncrono continua síncrono', () => {
      const resultado = caso.sincrono(1, 1);
      expect(resultado).toBe(2);
      expect(typeof (resultado as unknown as { then?: unknown })?.then).toBe(
        'undefined',
      );
    });

    it('método async resolve para o MESMO objeto', async () => {
      const promessa = caso.assincrono('v');
      expect(typeof promessa.then).toBe('function');
      await expect(promessa).resolves.toEqual({ ok: 'v' });
    });

    it('re-lança o erro idêntico, preservando a classe', async () => {
      // A classe é o que os filters usam para decidir o status HTTP.
      expect(() => caso.levanta()).toThrow(TypeError);
      expect(() => caso.levanta()).toThrow('erro de dominio');
      await expect(caso.rejeita()).rejects.toBeInstanceOf(RangeError);
    });

    it('re-lança valor que não é Error', () => {
      // `throw 'string'` é legal em JS e aparece em código de terceiros. Um
      // `erro.constructor.name` descuidado levantaria aqui dentro do catch.
      expect(() => caso.levantaNaoErro()).toThrow('texto cru');
    });

    it('preserva o nome do método', () => {
      expect(caso.sincrono.name).toBe('sincrono');
    });
  });

  describe('fora de uma requisição', () => {
    it('funciona e não levanta — sem store de ALS', () => {
      // O DomainGaugesCollector roda em timer e chama infraestrutura decorada.
      expect(currentRequestContext()).toBeUndefined();
      expect(caso.sincrono(4, 4)).toBe(8);
    });
  });

  describe('dentro de uma requisição', () => {
    it('registra um passo com camada, classe, função e duração', () => {
      runWithRequestContext(() => {
        caso.sincrono(1, 2);

        const ctx = currentRequestContext();
        expect(ctx?.path).toHaveLength(1);
        const passo = ctx!.path[0];
        expect(passo.layer).toBe('application');
        // O nome real da classe, não string vazia: depende de `keepClassNames`
        // no .swcrc e de `tsc` não manglar.
        expect(passo.class).toBe('CasoDeUso');
        expect(passo.fn).toBe('sincrono');
        expect(typeof passo.ms).toBe('number');
        expect(passo.ms).toBeGreaterThanOrEqual(0);
      });
    });

    it('aninha por profundidade, na ordem de chamada', () => {
      runWithRequestContext(() => {
        caso.composto();

        const ctx = currentRequestContext();
        expect(ctx?.path.map((p) => [p.class, p.fn, p.depth])).toEqual([
          ['CasoDeUso', 'composto', 0],
          ['Repositorio', 'gravar', 1],
        ]);
      });
    });

    it('devolve a profundidade ao sair, inclusive com erro', () => {
      runWithRequestContext(() => {
        expect(() => caso.levanta()).toThrow();
        // Sem restaurar, o passo seguinte da mesma requisição sairia indentado
        // para sempre e a árvore ficaria ilegível depois do primeiro erro.
        expect(currentRequestContext()?.depth).toBe(0);
      });
    });

    it('marca o passo que falhou com a classe do erro', () => {
      runWithRequestContext(() => {
        expect(() => caso.levanta()).toThrow();
        expect(currentRequestContext()?.path[0].error).toBe('TypeError');
      });
    });

    it('registra o passo de um método async depois de resolver', async () => {
      await runWithRequestContext(async () => {
        await caso.assincrono('v');
        // Se o passo fosse registrado antes de resolver, a duração de todo
        // método async seria ~0 e a linha do caminho não valeria nada.
        const passo = currentRequestContext()?.path[0];
        expect(passo?.fn).toBe('assincrono');
        expect(passo?.ms).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('ownSpan', () => {
    class JaTemSpan {
      @Traced('application', { ownSpan: true })
      execute(valor: string): string {
        return `feito:${valor}`;
      }

      @Traced('application', { ownSpan: true })
      falha(): never {
        throw new TypeError('falhou');
      }
    }

    it('registra o passo do caminho sem alterar o retorno', () => {
      // O caso de `CreateSessionUseCase.execute`, que abre `session.create` — a
      // raiz que o ADR 0026 manda persistir. Envolvê-la tornaria falsa a
      // afirmação de `docs/reference/events.md` de que a raiz é `session.create`.
      runWithRequestContext(() => {
        expect(new JaTemSpan().execute('x')).toBe('feito:x');
        expect(currentRequestContext()?.path[0]).toMatchObject({
          layer: 'application',
          class: 'JaTemSpan',
          fn: 'execute',
        });
      });
    });

    it('não levanta ao operar sobre a span inerte, nem no erro', () => {
      // A span de mentira recebe setAttribute/recordException/setStatus/end. Se
      // algum deles levantasse, o `ownSpan` derrubaria o método instrumentado.
      runWithRequestContext(() => {
        expect(() => new JaTemSpan().falha()).toThrow(TypeError);
        expect(currentRequestContext()?.path[0].error).toBe('TypeError');
      });
    });
  });

  describe('metadata do Nest', () => {
    it('sobrevive à troca de descriptor.value', () => {
      // Simula o que `SetMetadata` do Nest faz: grava na função do método. Se o
      // decorator não copiasse, `@RequireRole` num método decorado sumiria.
      class ComMetadata {
        @Traced('application')
        acao(): string {
          return 'ok';
        }
      }

      const antes = Object.getOwnPropertyDescriptor(
        ComMetadata.prototype,
        'acao',
      )!.value as () => string;

      Reflect.defineMetadata('brabo:teste', 'valor', antes);

      // A cópia acontece na aplicação do decorator, então aqui se afirma o
      // mecanismo com uma segunda aplicação manual.
      const descriptor: PropertyDescriptor = { value: antes };
      Traced('application')(ComMetadata.prototype, 'acao', descriptor);

      const copiada: unknown = Reflect.getOwnMetadata(
        'brabo:teste',
        descriptor.value as object,
      );
      expect(copiada).toBe('valor');
    });
  });
});
