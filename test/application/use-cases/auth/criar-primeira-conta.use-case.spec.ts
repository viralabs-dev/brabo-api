import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CriarPrimeiraContaUseCase } from '../../../../src/application/use-cases/auth/criar-primeira-conta.use-case';
import { ProvisionarUsuarioUseCase } from '../../../../src/application/use-cases/auth/provisionar-usuario.use-case';
import type { AuthCredentialRepository } from '../../../../src/application/ports/auth-credential-repository.port';
import type { AuthEventRecorder } from '../../../../src/application/ports/auth-event-recorder.port';
import type { PasswordHasher } from '../../../../src/application/ports/password-hasher.port';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { UserRepository } from '../../../../src/application/ports/user-repository.port';
import type { WorkspaceRepository } from '../../../../src/application/ports/workspace-repository.port';
import { COMPRIMENTO_MINIMO } from '../../../../src/domain/auth/password-policy';

const SENHA_BOA = 'uma frase longa e minha';

function buildHarness(opts: { jaTemUsuario?: boolean } = {}) {
  // `runInTransaction` de verdade é REENTRANTE — o fake espelha isso apenas
  // executando o trabalho, que é o que importa para estes testes: o caso de
  // uso aninha `ProvisionarUsuarioUseCase` dentro da própria transação.
  const runInTransaction = vi.fn(<T>(work: () => Promise<T>) => work());
  const unitOfWork = { runInTransaction } as unknown as UnitOfWork;

  const existeAlgumUsuario = vi.fn(() =>
    Promise.resolve(opts.jaTemUsuario ?? false),
  );
  const usuarios = { existeAlgumUsuario } as unknown as UserRepository;

  const criarUsuarioComCredencial = vi.fn(
    (entrada: { email: string; name: string | null }) =>
      Promise.resolve({
        userId: 'user-1',
        email: entrada.email,
        credencial: null,
      }),
  );
  const marcarEmailVerificado = vi.fn(() => Promise.resolve());
  const findByEmail = vi.fn(() => Promise.resolve(null));
  const credenciais = {
    findByEmail,
    criarUsuarioComCredencial,
    marcarEmailVerificado,
  } as unknown as AuthCredentialRepository;

  const hash = vi.fn((senha: string) => Promise.resolve(`hash:${senha}`));
  const hasher = { hash } as unknown as PasswordHasher;

  const create = vi.fn((entrada: { name: string; slug: string }) =>
    Promise.resolve({ id: 'ws-1', ...entrada }),
  );
  const addMember = vi.fn(() => Promise.resolve({}));
  const workspaces = { create, addMember } as unknown as WorkspaceRepository;

  const registrar = vi.fn(() => Promise.resolve());
  const eventos = { registrar } as unknown as AuthEventRecorder;

  const provisionar = new ProvisionarUsuarioUseCase(
    credenciais,
    hasher,
    unitOfWork,
  );

  return {
    useCase: new CriarPrimeiraContaUseCase(
      unitOfWork,
      usuarios,
      provisionar,
      workspaces,
      eventos,
    ),
    existeAlgumUsuario,
    criarUsuarioComCredencial,
    marcarEmailVerificado,
    hash,
    create,
    addMember,
    registrar,
  };
}

describe('CriarPrimeiraContaUseCase (RN-546, ADR 0155)', () => {
  it('caminho feliz: cria a conta JÁ VERIFICADA e o workspace pessoal, e devolve os três ids', async () => {
    const h = buildHarness();

    const criada = await h.useCase.execute({
      email: 'Voce@Exemplo.dev',
      senha: SENHA_BOA,
      nome: 'Fulana de Tal',
    });

    expect(criada).toEqual({
      userId: 'user-1',
      email: 'voce@exemplo.dev',
      workspaceId: 'ws-1',
    });

    // Verificada sem e-mail nenhum ter sido enviado — é o ponto 2 do ADR.
    expect(h.marcarEmailVerificado).toHaveBeenCalledWith('user-1');

    // RN-410: o workspace pessoal nasce junto, com o usuário como `owner`.
    expect(h.create).toHaveBeenCalledWith({
      name: 'Workspace de Fulana de Tal',
      slug: 'fulana-de-tal-user-1',
      createdBy: 'user-1',
    });
    expect(h.addMember).toHaveBeenCalledWith('ws-1', 'user-1', 'owner');

    // A senha vira hash e nada mais: nunca volta na resposta, nunca é gravada
    // em claro.
    expect(h.hash).toHaveBeenCalledWith(SENHA_BOA);
    expect(JSON.stringify(criada)).not.toContain(SENHA_BOA);
  });

  it('registra `first_account_created`, e não `register_created`', async () => {
    const h = buildHarness();

    await h.useCase.execute({ email: 'voce@exemplo.dev', senha: SENHA_BOA });

    expect(h.registrar).toHaveBeenCalledWith({
      kind: 'first_account_created',
      subjectKey: 'user:user-1',
      userId: 'user-1',
    });
  });

  it('FALHA: a instalação já tem QUALQUER usuário — 409, e nada é escrito', async () => {
    const h = buildHarness({ jaTemUsuario: true });

    await expect(
      h.useCase.execute({ email: 'outro@exemplo.dev', senha: SENHA_BOA }),
    ).rejects.toBeInstanceOf(ConflictException);

    // A condição é sobre a INSTALAÇÃO, não sobre o e-mail: um e-mail inédito
    // também recusa, e é o que separa esta rota de um criador de contas.
    expect(h.existeAlgumUsuario).toHaveBeenCalled();
    expect(h.criarUsuarioComCredencial).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.registrar).not.toHaveBeenCalled();
  });

  it('FALHA: senha curta cai na MESMA régua do domínio — 400, antes de olhar o banco', async () => {
    const h = buildHarness();

    // 400 e não 500: `PoliticaDeSenhaError` é `Error` de domínio e não tem
    // filtro global, então o caso de uso TRADUZ. Quem instala precisa ler
    // "escolha outra senha", não "erro do servidor".
    await expect(
      h.useCase.execute({ email: 'voce@exemplo.dev', senha: 'curta' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.useCase.execute({ email: 'voce@exemplo.dev', senha: 'curta' }),
    ).rejects.toThrow(String(COMPRIMENTO_MINIMO));

    // Antes de qualquer I/O: o instalador não carrega uma segunda régua, e a
    // primeira roda cedo.
    expect(h.existeAlgumUsuario).not.toHaveBeenCalled();
    expect(h.criarUsuarioComCredencial).not.toHaveBeenCalled();
  });

  it('FALHA: a política recusa por motivo que NÃO é comprimento — as cinco recusas passam pela mesma chamada', async () => {
    const h = buildHarness();

    // 12 caracteres (passa no comprimento) e um caractere só: é a recusa
    // `so_repeticao`. Um `@MinLength` no DTO nunca a veria — é por isso que a
    // régua é a do domínio, e não uma cópia na borda HTTP.
    await expect(
      h.useCase.execute({ email: 'voce@exemplo.dev', senha: 'aaaaaaaaaaaa' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.criarUsuarioComCredencial).not.toHaveBeenCalled();
  });

  it('sem `nome`, o workspace pessoal cai no local-part do e-mail — nada é inventado', async () => {
    const h = buildHarness();

    await h.useCase.execute({ email: 'voce@exemplo.dev', senha: SENHA_BOA });

    expect(h.create).toHaveBeenCalledWith({
      name: 'Workspace de voce',
      slug: 'voce-user-1',
      createdBy: 'user-1',
    });
  });
});
