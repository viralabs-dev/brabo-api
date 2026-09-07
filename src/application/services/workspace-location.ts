import { BadRequestException } from '@nestjs/common';
import type { ProjectExecutionMode } from '../../domain/iam/project.entity';
import { dentroDoEscopo } from '../../domain/actions/path-scope';
import {
  caminhoDeWorkspaceLocalValido,
  dentroDaBaseDeProjetos,
  motivoDeForaDaBaseDeProjetos,
  normalizarSemBarraFinal,
} from '../../infrastructure/filesystem/project-workspaces-root';

/**
 * O par (executionMode, workspacePath) validado — o valor que vai para a
 * coluna: `null` no modo `container`, o caminho normalizado só LEXICAMENTE
 * (sem I/O) nos modos `mounted` e `runner`, com `mounted` acrescentando a
 * exigência de estar dentro de `BRABO_PROJECTS_BASE`.
 *
 * Extraída de `CreateProjectUseCase` (RN-170/RN-422/RN-423) para
 * `ConvertProjectExecutionModeUseCase` (RN-447, ADR 0111) poder REUSAR a
 * mesma régua em vez de duplicá-la — a criação e a conversão validam
 * exatamente a mesma pergunta ("este (modo, caminho) é válido?"), só o
 * MOMENTO em que ela é feita muda.
 *
 * ## `mounted` não toca mais DISCO aqui (ADR 0142, RN-501)
 *
 * Até a RN-500 este ramo chamava `validarCaminhoDeWorkspaceLocal`, que exigia
 * a pasta EXISTINDO e GRAVÁVEL de dentro do container da api no instante da
 * criação. Isso tornava impossível o requisito do dono do produto — *"se for
 * Pasta montada, o bind-mount deve ser criado APÓS a decisão do Arquiteto"* —,
 * porque a criação recusava muito antes de haver decisão nenhuma.
 *
 * O que entrou no lugar é a MESMA disciplina que `runner` já tinha (RN-423):
 * léxico agora, disco depois, por quem tem autoridade para responder. A
 * diferença entre os dois modos continua sendo QUANDO/QUEM confirma o disco —
 * no `runner` é o CLI conectando; no `mounted` é `materializarWorkspaceMontado`
 * (a conversão, e a subida do container pela Infra).
 *
 * E entrou UMA regra nova, que só o `mounted` tem: o caminho precisa estar
 * dentro de `BRABO_PROJECTS_BASE` (ADR 0141). Não é rigor extra — é a única
 * pasta que os containers da api e do engine enxergam, então um caminho fora
 * dela produz exatamente o projeto que trava depois que esta validação existe
 * para impedir. Sem base configurada, o modo não está disponível nesta
 * instalação, e a recusa DIZ isso em vez de fingir que o caminho é que estava
 * errado.
 *
 * Caminho enviado junto com `container` é RECUSADO em vez de ignorado. Um
 * campo silenciosamente descartado é a semente de "mas eu configurei" — e o
 * CHECK do banco recusaria a linha de qualquer jeito; melhor um 400 que
 * explica do que um 500 vindo do Postgres. O CHECK, aliás, não muda com nada
 * disto: `mounted` continua gravando `workspace_path` NÃO-nulo, e adiar a
 * VERIFICAÇÃO nunca toca o invariante de PAREAMENTO.
 */
export function validarExecutionModeEWorkspacePath(
  executionMode: ProjectExecutionMode,
  workspacePathInput: string | null | undefined,
): string | null {
  const caminho = workspacePathInput?.trim();

  if (executionMode === 'container') {
    if (caminho) {
      throw new BadRequestException(
        'workspacePath só vale para projeto nos modos "mounted"/"runner". ' +
          'No modo "container" a pasta é gerenciada pelo produto, dentro ' +
          'de PROJECT_WORKSPACES_ROOT.',
      );
    }
    return null;
  }

  if (!caminho) {
    throw new BadRequestException(
      `Projeto no modo "${executionMode}" precisa de workspacePath: o caminho ` +
        'absoluto da pasta do seu computador onde o código vai morar.',
    );
  }

  if (executionMode === 'runner') {
    if (!caminhoDeWorkspaceLocalValido(caminho)) {
      throw new BadRequestException(
        `Caminho inválido para um projeto "runner": ${JSON.stringify(caminho)}. ` +
          'Ele precisa ser absoluto (começar com "/"), sem ".." no meio, e ' +
          'não pode ser a raiz do sistema nem se sobrepor ao checkout do ' +
          'próprio Brabo. O disco só é verificado quando o runner conectar ' +
          '— rode "brabo-runner --project <id> --dir <pasta>" depois de ' +
          'criar o projeto.',
      );
    }
    // Mesma normalização que o léxico usa — o valor GRAVADO é o
    // normalizado, nunca a string crua que chegou (mesmo motivo de
    // `mounted` abaixo).
    return normalizarSemBarraFinal(caminho);
  }

  // `mounted`: léxico + base, sem I/O nenhum (ADR 0142, RN-501).
  if (!caminhoDeWorkspaceLocalValido(caminho)) {
    throw new BadRequestException(
      `Caminho inválido para um projeto "mounted": ${JSON.stringify(caminho)}. ` +
        'Ele precisa ser absoluto (começar com "/"), sem ".." no meio, e ' +
        'não pode ser a raiz do sistema, uma pasta de sistema nem se ' +
        'sobrepor ao checkout do próprio Brabo (ADR 0055).',
    );
  }

  const normalizado = normalizarSemBarraFinal(caminho);

  // A mensagem vem da MESMA fonte que a materialização usa: as duas portas
  // recusam pelo mesmo motivo, e duas redações divergiriam no dia em que a
  // base ganhar outra forma. Ela cobre os DOIS casos — fora da base, e base
  // não configurada (o modo não está disponível nesta instalação).
  if (!dentroDaBaseDeProjetos(normalizado)) {
    throw new BadRequestException(motivoDeForaDaBaseDeProjetos(normalizado));
  }

  // Mesma normalização de `runner`: o valor GRAVADO é o normalizado, nunca a
  // string crua que chegou.
  return normalizado;
}

/**
 * O destino do espelho validado — o valor que vai para a coluna `mirror_path`
 * (RN-515, ADR 0147 ponto 4): `null` quando o usuário limpa o destino, ou o
 * caminho normalizado só LEXICAMENTE.
 *
 * ## Por que só o léxico, e por que a api DIZ que é só o léxico
 *
 * A api **não enxerga** a máquina onde o destino vai existir. É exatamente a
 * situação do modo `runner` (RN-423) e não a do `mounted`: em `mounted` a
 * pasta acaba dentro da base montada, que a api alcança de verdade; o destino
 * do espelho é, por definição, uma pasta **fora** da base — a razão de o
 * espelho existir (ADR 0147: *"bind mount não atravessa rede nem alcança
 * caminho fora do que foi montado"*).
 *
 * Por isso ela reusa `caminhoDeWorkspaceLocalValido`, o MESMO predicado
 * léxico da criação e da conversão, em vez de uma quarta cópia da mesma
 * régua — absoluto, sem `..`/`.`, nunca a raiz nem pasta de sistema, nunca
 * sobreposto ao checkout do Brabo. E **não** exige a base: o destino do
 * espelho é a pasta que a base não cobre.
 *
 * ## Os dois sentidos do mesmo laço
 *
 * Destino DENTRO do `workspacePath` do projeto, e destino CONTENDO ele, são a
 * mesma recusa vista de dois lados (ADR 0147 ponto 2): com o bind por
 * identidade do ADR 0141, escrever o espelho dentro da origem faz o espelho
 * copiar o próprio espelho, e uma origem dentro do destino faz a cópia
 * aninhar-se a cada rodada. Recusar um e permitir o outro seria fechar a porta
 * e deixar a janela.
 *
 * A comparação é por SEGMENTO (`dentroDoEscopo`), nunca `startsWith` cru:
 * `/base-outra` NÃO está dentro de `/base`, embora a string comece igual.
 *
 * ## Esta é a metade LÉXICA da guarda — e só ela
 *
 * A outra metade é `realpath`, e ela é do RUNNER (`espelho-guard.ts`, ADR
 * 0147 ponto 2), na máquina onde os dois caminhos existem de verdade. Um
 * symlink em qualquer segmento do destino apontando de volta para a origem
 * passa por aqui sem ser visto — a api não tem disco onde resolvê-lo. **Não
 * confunda esta função com a garantia**: o que ela impede é o laço ESCRITO,
 * não o laço construído por link simbólico.
 */
export function validarDestinoDeEspelho(
  executionMode: ProjectExecutionMode,
  workspacePath: string | null,
  destinoInput: string | null | undefined,
): string | null {
  const destino = destinoInput?.trim();

  // Limpar o destino é sempre possível, e vem ANTES da recusa de
  // `container`: um projeto que ficou com destino gravado e depois virou
  // `container` precisa poder ser limpo, e recusar a limpeza deixaria a
  // linha presa no estado que a regra proíbe.
  if (!destino) return null;

  // `container`: a origem é um volume GERENCIADO no servidor, e quem copiaria
  // é um processo na máquina do usuário, que não a enxerga. Recusa NOMEADA,
  // nunca aceitar e nunca copiar — um destino gravado que jamais recebe nada
  // é pior que a recusa, porque parece configurado.
  if (executionMode === 'container') {
    throw new BadRequestException(
      'Projeto no modo "container" não pode ter destino de espelho: o código ' +
        'mora num volume gerenciado NO SERVIDOR, e quem copiaria é o agente ' +
        'local, na SUA máquina, que não enxerga esse volume. Converta o ' +
        'projeto para "mounted" ou "runner" antes de declarar um destino.',
    );
  }

  if (!caminhoDeWorkspaceLocalValido(destino)) {
    throw new BadRequestException(
      `Destino de espelho inválido: ${JSON.stringify(destino)}. Ele precisa ` +
        'ser absoluto (começar com "/"), sem ".." nem "." no meio, e não ' +
        'pode ser a raiz do sistema, uma pasta de sistema nem se sobrepor ao ' +
        'checkout do próprio Brabo. O disco NÃO é verificado aqui — o ' +
        'destino fica na sua máquina, e quem confirma que ele existe é o ' +
        'agente local (brabo-runner) na hora de copiar.',
    );
  }

  const normalizado = normalizarSemBarraFinal(destino);

  // Os dois sentidos do laço origem↔destino. `workspacePath` nulo só
  // acontece em `container`, já recusado acima — mas a guarda é escrita sem
  // depender disso, porque o par (modo, caminho) é garantido pelo CHECK do
  // banco e não por esta função.
  if (workspacePath) {
    const origem = normalizarSemBarraFinal(workspacePath);
    if (dentroDoEscopo(normalizado, origem)) {
      throw new BadRequestException(
        `Destino de espelho ${JSON.stringify(normalizado)} está DENTRO da ` +
          `pasta do projeto (${origem}) — o espelho passaria a copiar o ` +
          'próprio espelho, a cada rodada. Escolha uma pasta fora dela.',
      );
    }
    if (dentroDoEscopo(origem, normalizado)) {
      throw new BadRequestException(
        `Destino de espelho ${JSON.stringify(normalizado)} CONTÉM a pasta do ` +
          `projeto (${origem}) — é o mesmo laço, no sentido contrário: a ` +
          'origem passaria a viver dentro do destino. Escolha uma pasta que ' +
          'não seja ancestral dela.',
      );
    }
  }

  // O valor GRAVADO é o normalizado, nunca a string crua que chegou — mesma
  // disciplina de `validarExecutionModeEWorkspacePath` acima.
  return normalizado;
}
