import { Injectable } from '@nestjs/common';
import {
  TaskRepository,
  type TarefaEmCursoDeDev,
} from '../../ports/backlog-repository.port';

/**
 * RN-856 (AT-522): as tarefas `in_progress` do projeto da sessão de execução
 * seguradas por um dev
 * agent, fora de gate e não bloqueadas. Quem pergunta é o
 * `Engine.Dev.EncerramentoDaSessao` ao parar a execução: a que nenhuma linha
 * de `dev_agent_states` segura é ÓRFÃ (o processo que a tinha já morreu), e é
 * bloqueada como as outras, para aparecer em "Tarefas bloqueadas" com o
 * "Desbloquear" — sem isso, nada na tela a liberava.
 */
@Injectable()
export class ListTarefasEmCursoDeDevUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  execute(sessionId: string): Promise<TarefaEmCursoDeDev[]> {
    return this.tasks.listEmCursoDeDev(sessionId);
  }
}
