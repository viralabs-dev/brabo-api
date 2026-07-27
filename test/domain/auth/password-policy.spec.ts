import { describe, it, expect } from 'vitest';
import {
  avaliarSenha,
  exigirSenhaValida,
  PoliticaDeSenhaError,
  COMPRIMENTO_MINIMO,
  PROIBIDAS,
} from '../../../src/domain/auth/password-policy';

const EMAIL = 'fulano@brabo.dev';

describe('política de senha', () => {
  it('caminho feliz: frase longa sem símbolo nenhum passa', () => {
    // O ponto da política: comprimento, não composição. Uma frase assim é
    // muito mais cara de quebrar do que `Senha@123`, que uma regra de
    // composição aprovaria e esta recusa.
    expect(avaliarSenha('cavalo bateria grampo correto', EMAIL)).toBeNull();
  });

  it('recusa senha curta', () => {
    expect(avaliarSenha('a'.repeat(COMPRIMENTO_MINIMO - 1), EMAIL)).toBe(
      'curta',
    );
  });

  it('recusa senha absurdamente longa', () => {
    // Teto de proteção, não de política: argon2id copia a entrada antes de
    // derivar, então senha de megabytes vira custo de memória numa rota
    // pública.
    expect(avaliarSenha('a'.repeat(2000), EMAIL)).toBe('longa');
  });

  it('recusa um único caractere repetido, mesmo com o comprimento certo', () => {
    expect(avaliarSenha('aaaaaaaaaaaaaaaa', EMAIL)).toBe('so_repeticao');
  });

  it('recusa senha da lista de óbvias, ignorando a caixa', () => {
    expect(avaliarSenha('Senha1234567', EMAIL)).toBe('comum');
  });

  it('nenhuma entrada da lista é inalcançável', () => {
    // A checagem de comprimento roda antes da lista. Uma entrada com menos de
    // COMPRIMENTO_MINIMO caracteres nunca chega a ser consultada — ela seria
    // recusada como "curta" —, então estar na lista dá só a impressão de
    // cobertura. Foi exatamente o defeito que este teste pegou na primeira
    // versão da lista.
    const curtas = [...PROIBIDAS].filter(
      (senha) => senha.length < COMPRIMENTO_MINIMO,
    );
    expect(
      curtas,
      `entradas curtas demais para serem alcançadas: ${curtas.join(', ')}`,
    ).toEqual([]);
  });

  it('cada entrada da lista é de fato recusada como comum', () => {
    for (const senha of PROIBIDAS) {
      expect(avaliarSenha(senha, EMAIL), senha).toBe('comum');
    }
  });

  it('recusa a senha igual ao e-mail', () => {
    expect(avaliarSenha(EMAIL, EMAIL)).toBe('igual_ao_email');
  });

  it('recusa a senha igual à parte local do e-mail', () => {
    expect(
      avaliarSenha('desenvolvedor', 'desenvolvedor@brabo.dev'),
    ).toBe('igual_ao_email');
  });

  it('compara o e-mail normalizado, não o literal', () => {
    // Senão bastaria trocar a caixa de uma letra para usar o próprio e-mail
    // como senha.
    expect(avaliarSenha('Fulano@Brabo.dev', '  FULANO@brabo.DEV ')).toBe(
      'igual_ao_email',
    );
  });

  it('parte local curta não é comparada — perderia para o mínimo antes', () => {
    // `ana` tem 3 caracteres: uma senha igual a ela já é recusada por curta, e
    // uma senha longa que contenha `ana` não tem por que ser recusada.
    expect(avaliarSenha('ana e o computador', 'ana@brabo.dev')).toBeNull();
  });

  it('exigirSenhaValida lança com a falha classificada', () => {
    expect(() => exigirSenhaValida('curta', EMAIL)).toThrow(
      PoliticaDeSenhaError,
    );
    try {
      exigirSenhaValida('curta', EMAIL);
    } catch (erro) {
      expect((erro as PoliticaDeSenhaError).falha).toBe('curta');
    }
  });

  it('exigirSenhaValida não lança no caminho feliz', () => {
    expect(() =>
      exigirSenhaValida('uma senha bem comprida mesmo', EMAIL),
    ).not.toThrow();
  });
});
