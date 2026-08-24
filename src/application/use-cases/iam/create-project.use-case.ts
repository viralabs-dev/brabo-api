import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';
import { SeedAgentAreasUseCase } from '../agents/seed-agent-areas.use-case';
import { workspaceDirNameFor } from '../../../infrastructure/filesystem/project-workspaces-root';
import { validarExecutionModeEWorkspacePath } from '../../services/workspace-location';

@Injectable()
export class CreateProjectUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly seedAreas: SeedAgentAreasUseCase,
  ) {}

  /**
   * O projeto nasce COM as áreas de agente (RN-094).
   *
   * Na mesma transação, pelo mesmo motivo de `CreateWorkspaceUseCase` gravar o
   * `owner` junto: projeto sem área é projeto onde o teto de paralelismo lê
   * tabela vazia e cai no default sem que ninguém tenha decidido nada. Se o
   * seeding falhar, o projeto não existe — em vez de existir quebrado, que é o
   * estado que a FASE 18 foi corrigir.
   *
   * O id nasce AQUI, em código (`randomUUID`), e não do `defaultRandom()` do
   * Postgres — o nome da pasta do workspace (RN-109) se compõe do id ANTES de
   * o projeto existir na tabela, então o use case precisa do id em mãos antes
   * do insert.
   *
   * ## Os modos `mounted`/`runner` recusam ANTES de criar (RN-170/RN-422)
   *
   * Um projeto `mounted` cujo caminho não existe dentro do container, ou não
   * é gravável por ele, é um projeto que NASCE quebrado e só descobre isso
   * muito depois — na primeira ferramenta do primeiro agente, numa tela que
   * não é esta, com uma mensagem de erro de sistema de arquivos que não
   * ensina nada. Por isso a validação é aqui, na criação, e recusa: 400 com a
   * instrução de como montar a pasta é a única resposta que o usuário
   * consegue agir.
   *
   * `runner` é diferente (RN-423): a criação valida só a parte LÉXICA do
   * caminho, sem tocar disco — só o runner, rodando no host de verdade, tem
   * autoridade para confirmar que a pasta existe. O projeto nasce com
   * `workspaceVerifiedAt: null` e é promovido quando a confirmação chega
   * (`ConfirmProjectWorkspaceUseCase`).
   *
   * A validação roda ANTES do `runInTransaction` de propósito. Em `mounted`
   * ela toca disco, e prender uma transação do Postgres enquanto se faz
   * `stat` numa montagem de rede que pode estar pendurada é segurar conexão
   * do pool por um motivo que nada tem a ver com o banco.
   *
   * `async` para que a recusa seja sempre uma promessa REJEITADA, e não um
   * `throw` síncrono de algum ramo convivendo com rejeição no resto: quem
   * chama trataria os dois de formas diferentes, e o `try/catch` que cobre um
   * deixaria o outro passar.
   */
  async execute(workspaceId: string, userId: string, input: ProjectInput) {
    const workspacePath = validarExecutionModeEWorkspacePath(
      input.executionMode ?? 'container',
      input.workspacePath,
    );

    return this.unitOfWork.runInTransaction(async () => {
      const id = randomUUID();
      const project = await this.projects.create({
        ...input,
        id,
        workspaceId,
        createdBy: userId,
        workspaceDirName: workspaceDirNameFor(id, input.slug),
        executionMode: input.executionMode ?? 'container',
        // Normalizado pela validação, e não a string crua que chegou: o CHECK
        // do banco exige o par coerente, e gravar exatamente o que foi
        // validado é o que impede a raiz derivada amanhã de ser outra.
        workspacePath,
        // Implícito NULL (default da coluna) — `runner` só ganha
        // `workspaceVerifiedAt` quando um runner conectar e confirmar
        // (RN-423); `container`/`mounted` nunca preenchem este campo.
      });
      await this.seedAreas.execute(project.id);
      return project;
    });
  }
}
