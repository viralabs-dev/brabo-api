import { describe, it, expect } from 'vitest';
import {
  decidirParalelismo,
  motivoDoPedido,
} from '../../../src/domain/execution/paralelismo';

describe('decidirParalelismo', () => {
  it('dentro do teto, o lead sobe e segue', () => {
    const d = decidirParalelismo({
      ativosNaSessao: 1,
      pedidos: 1,
      maxParallel: 2,
    });

    expect(d).toEqual({ permitido: true, requerAutorizacao: false });
  });

  it('exatamente no teto ainda dispensa autorização', () => {
    // A fronteira importa: `<=` e não `<`. Com `<`, o default de 2 na prática
    // viraria 1, e todo segundo agente pediria clique.
    const d = decidirParalelismo({
      ativosNaSessao: 0,
      pedidos: 2,
      maxParallel: 2,
    });

    expect(d).toEqual({ permitido: true, requerAutorizacao: false });
  });

  it('acima do teto, vira decisão do usuário', () => {
    const d = decidirParalelismo({
      ativosNaSessao: 2,
      pedidos: 1,
      maxParallel: 2,
    });

    expect(d).toEqual({
      permitido: true,
      requerAutorizacao: true,
      excedente: 1,
    });
  });

  // O ponto central da regra, e o que um refactor desatento desfaz.
  it('o teto é da SESSÃO, não do módulo', () => {
    // Três módulos com um agente cada já ocupam a sessão inteira. Contar por
    // módulo diria "cada um tem só 1, pode subir" — que é o buraco de hoje
    // com outro nome: N módulos × 2 sem autorização nenhuma.
    const d = decidirParalelismo({
      ativosNaSessao: 3,
      pedidos: 1,
      maxParallel: 2,
    });

    expect(d).toMatchObject({ requerAutorizacao: true, excedente: 2 });
  });

  it('teto maior, configurado pelo usuário, dispensa mais', () => {
    const d = decidirParalelismo({
      ativosNaSessao: 4,
      pedidos: 1,
      maxParallel: 5,
    });

    expect(d).toEqual({ permitido: true, requerAutorizacao: false });
  });

  it('teto zero ou negativo é configuração INVÁLIDA, não "sem limite"', () => {
    // Tratar como ilimitado transformaria um erro de digitação em gasto
    // irrestrito — exatamente o que o pipeline de aprovação existe para
    // impedir.
    expect(
      decidirParalelismo({ ativosNaSessao: 0, pedidos: 1, maxParallel: 0 }),
    ).toMatchObject({ permitido: false });

    expect(
      decidirParalelismo({ ativosNaSessao: 0, pedidos: 1, maxParallel: -1 }),
    ).toMatchObject({ permitido: false });
  });

  it('pedido de zero agente é recusado', () => {
    expect(
      decidirParalelismo({ ativosNaSessao: 0, pedidos: 0, maxParallel: 2 }),
    ).toMatchObject({ permitido: false });
  });
});

describe('motivoDoPedido', () => {
  it('diz os três números que a decisão exige', () => {
    // O texto vai para o payload IMUTÁVEL da proposed_action. Quem ler daqui
    // a seis meses precisa entender o que foi autorizado sem reconstruir o
    // estado da sessão.
    const texto = motivoDoPedido({
      ativosNaSessao: 2,
      pedidos: 2,
      maxParallel: 2,
    });

    expect(texto).toContain('2 agente(s) a mais');
    expect(texto).toContain('já tem 2');
    expect(texto).toContain('levaria a 4');
    expect(texto).toContain('teto de 2');
  });
});
