import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpsertCredentialDto } from '../../src/interfaces/http/llm/dto/upsert-credential.dto';
import { RegisterGitCredentialDto } from '../../src/interfaces/http/git/dto/register-git-credential.dto';
import { CREDENCIAL_COMPRIMENTO_MAXIMO } from '../../src/domain/llm/user-credential.entity';

/**
 * O teto de comprimento da credencial é PROTEÇÃO, não validação de formato — e
 * a diferença é o que estes testes fixam.
 *
 * A tentação, depois de uma chave truncada ter sido gravada em silêncio, é
 * apertar o teto até ele "validar" a chave. Não pode: as credenciais reais dos
 * nove providers variam de ~26 (`glpat-`) a ~164 caracteres (project key da
 * OpenAI), e um teto perto do tamanho real recusaria cadastro de chave boa —
 * o modo de falha que o ADR 0050 removeu. Quem diz se a chave presta é o
 * provider, na rota de teste.
 */
function erros(
  dto: object,
  cls: typeof UpsertCredentialDto | typeof RegisterGitCredentialDto,
) {
  return validateSync(plainToInstance(cls, dto) as object);
}

/** Comprimentos publicados por cada provider — a régua que o teto não pode cortar. */
const CREDENCIAIS_REAIS = [
  { rotulo: 'GitLab PAT', comprimento: 26 },
  { rotulo: 'GitHub PAT clássico', comprimento: 40 },
  { rotulo: 'OpenRouter', comprimento: 73 },
  { rotulo: 'GitHub PAT fine-grained', comprimento: 93 },
  { rotulo: 'Anthropic', comprimento: 108 },
  { rotulo: 'OpenAI project key', comprimento: 164 },
];

describe('teto de comprimento da credencial', () => {
  it('o teto cabe com folga a maior credencial conhecida', () => {
    const maior = Math.max(...CREDENCIAIS_REAIS.map((c) => c.comprimento));
    expect(CREDENCIAL_COMPRIMENTO_MAXIMO).toBeGreaterThan(maior * 2);
  });

  describe.each(CREDENCIAIS_REAIS)(
    '$rotulo ($comprimento chars)',
    ({ comprimento }) => {
      it('passa no cadastro de chave de LLM', () => {
        expect(
          erros(
            { provider: 'anthropic', apiKey: 'k'.repeat(comprimento) },
            UpsertCredentialDto,
          ),
        ).toHaveLength(0);
      });

      it('passa no cadastro de token de git', () => {
        expect(
          erros(
            { provider: 'github', token: 'k'.repeat(comprimento) },
            RegisterGitCredentialDto,
          ),
        ).toHaveLength(0);
      });
    },
  );

  it('payload absurdo é recusado nas duas rotas', () => {
    const absurdo = 'k'.repeat(CREDENCIAL_COMPRIMENTO_MAXIMO + 1);

    expect(
      erros({ provider: 'anthropic', apiKey: absurdo }, UpsertCredentialDto),
    ).not.toHaveLength(0);
    expect(
      erros({ provider: 'github', token: absurdo }, RegisterGitCredentialDto),
    ).not.toHaveLength(0);
  });

  it('exatamente no teto ainda passa', () => {
    const noLimite = 'k'.repeat(CREDENCIAL_COMPRIMENTO_MAXIMO);

    expect(
      erros({ provider: 'anthropic', apiKey: noLimite }, UpsertCredentialDto),
    ).toHaveLength(0);
    expect(
      erros({ provider: 'github', token: noLimite }, RegisterGitCredentialDto),
    ).toHaveLength(0);
  });

  /**
   * A chave de 18 caracteres que originou tudo isto. Ela CONTINUA sendo aceita
   * — e é isso que se está afirmando: o teto não julga formato, e uma colagem
   * pela metade só é descoberta pela rota de teste, que devolve o motivo do
   * provider (`User not found.`, no caso do OpenRouter).
   */
  it('chave truncada continua sendo aceita — o teto não é validador de formato', () => {
    expect(
      erros(
        { provider: 'openrouter', apiKey: 'sk-or-v1-abcdefghi' },
        UpsertCredentialDto,
      ),
    ).toHaveLength(0);
  });

  it('vazio continua recusado', () => {
    expect(
      erros({ provider: 'anthropic', apiKey: '' }, UpsertCredentialDto),
    ).not.toHaveLength(0);
  });
});
