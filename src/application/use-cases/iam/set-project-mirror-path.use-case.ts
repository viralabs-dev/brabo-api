import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import type { Project } from '../../../domain/iam/project.entity';
import { validarDestinoDeEspelho } from '../../services/workspace-location';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface SetProjectMirrorPathInput {
  /**
   * O destino, ou `null` para LIMPAR. Nunca `undefined` na borda: o DTO
   * exige a chave presente, porque um corpo que omite o campo seria
   * indistinguível de "limpe o destino", e limpar em silêncio é o defeito.
   */
  mirrorPath: string | null;
}

/**
 * Declara (ou limpa) o DESTINO do espelho de um projeto — a pasta da máquina
 * do usuário, fora da base montada, para onde o agente local copia o trabalho
 * (RN-515, ADR 0147 ponto 4).
 *
 * ## Por que uma rota dedicada, no molde de `execution-mode`
 *
 * `UpdateProjectDto` continua excluindo os campos de localização de propósito
 * (ver o comentário lá), e o destino do espelho é um deles: ele fala de uma
 * pasta do computador do OPERADOR, não de metadado do projeto. Daí o mesmo
 * papel mínimo de quem escolhe onde o código mora — `maintainer`, igual a
 * `PUT .../execution-mode`, a `GET workspaces/:id/projects-base` e a
 * `GET workspaces/:id/project-folders`.
 *
 * ## O que este caso de uso NÃO faz, e não deve passar a fazer
 *
 * Ele grava UMA coluna. Não copia nada, não fala com runner nenhum, não emite
 * `proposed_action` — e isso último é decisão, não omissão: o ADR 0147 é
 * explícito de que a escrita do espelho **não** é um agente pedindo para agir,
 * é o sistema escrevendo num caminho que o próprio usuário declarou. Fazer a
 * sincronização passar pela fila de aprovações a transformaria em rotina, e
 * uma fila em que quase tudo é rotina treina a pessoa a aprovar sem ler.
 *
 * Também não inventa estado de sincronização (última sync, contagem, último
 * erro): isso é telemetria de conexão, guardada junto dos outros fatos de
 * runner e nunca no event log (ADR 0147 ponto 7), e é entrega de outra
 * sessão da FASE 28.
 *
 * ## Sem 409 por dev agent ativo, ao contrário da conversão de modo
 *
 * `ConvertProjectExecutionModeUseCase` recusa enquanto há dev agent
 * não-ocioso porque ela move a RAIZ DE ESCOPO debaixo de um processo que a
 * capturou uma vez. O destino do espelho não é raiz de escopo de ninguém: o
 * worktree, o `permissions.json` e a política de terminal não o consultam, e
 * o pior que um agente vivo vê é a próxima cópia indo para o lugar novo — que
 * é literalmente o que quem trocou o destino pediu.
 */
@Injectable()
export class SetProjectMirrorPathUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  @Traced('application')
  async execute(
    projectId: string,
    input: SetProjectMirrorPathInput,
  ): Promise<Project> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // Toda a régua mora na função compartilhada, ao lado da que valida o par
    // (modo, caminho) da criação/conversão — inclusive a recusa de
    // `container` e os dois sentidos do laço origem↔destino. Não duplique
    // nada disto aqui: a validação de caminho deste produto já tem uma fonte.
    const destino = validarDestinoDeEspelho(
      project.executionMode,
      project.workspacePath,
      input.mirrorPath,
    );

    // Mesmo destino de hoje: não há o que gravar. Devolve o projeto como
    // está — mesma disciplina do "converter que não converte nada".
    if (destino === project.mirrorPath) return project;

    const atualizado = await this.projects.update(projectId, {
      mirrorPath: destino,
    });
    if (!atualizado) throw new NotFoundException('Projeto não encontrado');
    return atualizado;
  }
}
