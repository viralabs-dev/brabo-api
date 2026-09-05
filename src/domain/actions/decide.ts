import { roleAtLeast, type Role } from '../iam/role';
import type { PermissionPolicy, PermissionsFile } from './permissions-file';
import { matchesPattern, parseCommand } from './command-matcher';
import { isProtectedBranch } from './protected-branches';
import { comandoNoEscopo } from './path-scope';
import {
  efeitoExternoNoComando,
  mensagemDeEfeitoExterno,
  comandoPrivilegiadoNoComando,
  mensagemDeComandoPrivilegiado,
} from './external-effect';

export type ActionType =
  | 'terminal'
  | 'git_commit'
  | 'git_push'
  | 'pr_open'
  | 'spend'
  | 'git_repo_create'
  | 'git_branch_create'
  | 'git_branch_protect'
  | 'write_file'
  | 'open_adr_pr'
  | 'git_merge'
  | 'open_infra_pr'
  | 'instruction_patch'
  | 'parallelize'
  | 'raise_max_parallel'
  | 'propose_execution_plan'
  | 'assess_implementability'
  | 'container_start'
  | 'container_stop'
  | 'container_remove'
  | 'container_start_via_runner';

export const ACTION_TYPES: readonly ActionType[] = [
  'terminal',
  'git_commit',
  'git_push',
  'pr_open',
  'spend',
  'git_repo_create',
  'git_branch_create',
  'git_branch_protect',
  'write_file',
  'open_adr_pr',
  'git_merge',
  'open_infra_pr',
  'instruction_patch',
  // FASE 14d: o lead pedindo mais agentes do que o teto dele permite, e a
  // Anamnese propondo subir o próprio teto.
  'parallelize',
  'raise_max_parallel',
  // ADR 0086 (RN-284): o plano de execução do Dev Lead — antes um evento
  // simples, sem aprovação nenhuma no meio (achado A2 da auditoria
  // fluxo.yml x código). Ver o comentário no teto do paralelismo, abaixo,
  // sobre por que este tipo NÃO entra naquele bloco.
  'propose_execution_plan',
  // ADR 0090: o parecer de implementabilidade do Dev Lead (gate
  // `implementavel`, docs/gates.yml, ativo). Mesmo calibre e o mesmo
  // raciocínio de `propose_execution_plan` — decisão INICIAL, não
  // ultrapassagem de teto.
  'assess_implementability',
  // ADR 0130/0133: a Infra elege uma das imagens candidatas do roteamento do
  // Arquiteto e propõe subir o container REAL do projeto, pelo broker.
  'container_start',
  // ADR 0136 (RN-495): a página global de containers propõe estas duas —
  // nunca ação de agente, sempre um humano clicando "Parar"/"Remover" numa
  // linha da tela. Mesmo broker, mesma tabela `project_containers`.
  'container_stop',
  'container_remove',
  // RN-506 (ADR 0145): segundo tipo pra subir o container real do projeto —
  // exclusivo de `execution_mode: runner` (o Infra Lead consulta isso
  // LOCALMENTE, no engine, antes de propor; `decide()` aqui não olha modo,
  // igual já não olhava para `container_start`). NÃO elege imagem
  // candidata nenhuma (payload só tem `rationale` opcional) — o broker
  // nunca alcança a pasta de um projeto `runner`, então não há roteamento
  // do Arquiteto contra o qual eleger.
  'container_start_via_runner',
];

/**
 * Valor especial de `agent_autonomy.action_type` — "auto mode" (RN-153):
 * qualquer tipo de ação deste agente, não um tipo específico. NÃO entra em
 * `ACTION_TYPES`: não é um tipo de ação que `decide()` avalia, é um curinga
 * sobre uma coluna que já é texto livre, sem enum nem FK (`schema.ts`).
 *
 * A resolução do curinga (uma regra ESPECÍFICA sempre vence a curinga) mora
 * no repositório (`DrizzleAgentAutonomyRepository.findMode`), não aqui —
 * `decide()` continua recebendo só o `PermissionPolicy` já resolvido, exatamente
 * como antes do curinga existir. É por isso que os três tetos abaixo (escopo,
 * merge protegido, instruction_patch, paralelismo) valem para "auto mode" sem
 * precisar saber que ele existe: eles agem sobre `current.policy ===
 * 'auto_approve'`, não sobre a origem dela.
 */
export const AGENT_AUTONOMY_ALL_ACTIONS = '*' as const;
export type AgentAutonomyActionType =
  ActionType | typeof AGENT_AUTONOMY_ALL_ACTIONS;

const MIN_ROLE_FOR_ACTION_TYPE: Record<ActionType, Role> = {
  terminal: 'developer',
  git_commit: 'developer',
  git_push: 'maintainer',
  pr_open: 'maintainer',
  spend: 'owner',
  // Mutações do bootstrap de Gitflow (Fase 2, sessão 3) — calibrado igual
  // git_push, já que o endpoint de provisionamento já exige maintainer
  // (@RequireRole em git.controller.ts). Na prática o bootstrap nunca
  // passa por decide() (status nasce hardcoded auto_approved — ver
  // docs/adr/0005), mas o Record é exaustivo por tipo, então toda
  // ActionType precisa de uma entrada aqui mesmo assim.
  git_repo_create: 'maintainer',
  git_branch_create: 'maintainer',
  git_branch_protect: 'maintainer',
  // Escrita de arquivo por um agente fora da whitelist de paths (Fase 3a) —
  // calibrado como git_commit (developer): quem pode commitar pode propor
  // escrever um arquivo. Fica pending por padrão (sem regra em
  // permissions.json), pra o usuário aprovar.
  write_file: 'developer',
  // ADR commitado no repo do projeto + PR real aberta (Fase 3b — Arquiteto).
  // Calibrado como pr_open (maintainer): abre uma PR de verdade no provider.
  // Fica pending por padrão — o usuário aprova a ação (que então abre a PR) e
  // depois mergeia a PR real no provider.
  open_adr_pr: 'maintainer',
  // Merge de PR (Fase 4a). Merge com destino em branch protegida é SEMPRE
  // manual — a trava (teto em decide()) impede auto_approve independente da
  // configuração.
  git_merge: 'maintainer',
  // PR de infra (Fase 4a — InfraAgent): commita N arquivos (Dockerfiles/
  // compose/CI) e abre PR real, mesmo calibre de open_adr_pr (maintainer) —
  // fica pending por padrão, mas o accept-handoff do InfraAgent seeda
  // agent_autonomy auto_approve pra essa ação especificamente (o InfraAgent
  // NUNCA aplica nada, só propõe — auto-aprovar a PROPOSTA da PR é seguro).
  open_infra_pr: 'maintainer',
  // Patch no arquivo de instrução de um agente (Fase 4b — Anamnese):
  // muda o COMPORTAMENTO de um agente daí em diante, então é calibrado
  // como maintainer e tem teto de "nunca auto-aprovável" abaixo — o
  // usuário PRECISA ver o diff antes (CLAUDE.md 4b.9).
  instruction_patch: 'maintainer',
  // Subir agente é GASTO. `maintainer` pelo mesmo motivo de `spend`: quem
  // autoriza custo é quem responde pelo projeto.
  parallelize: 'maintainer',
  raise_max_parallel: 'maintainer',
  // O plano decide QUANTOS agentes sobem por módulo — mesmo calibre de
  // `parallelize`: é decisão de QUANTO o produto vai gastar com
  // paralelismo, só que na largada em vez de numa ultrapassagem de teto
  // (ADR 0086, RN-284).
  propose_execution_plan: 'maintainer',
  // Gate `implementavel` (ADR 0090): quem decide se uma story é
  // implementável é o mesmo calibre de quem decide o plano de execução —
  // `maintainer`, e DELIBERADAMENTE fora do bloco de tetos absolutos
  // abaixo (ver o comentário lá) pelo MESMO raciocínio de
  // `propose_execution_plan`: é uma decisão inicial da sessão, não uma
  // ultrapassagem de teto já autorizado.
  assess_implementability: 'maintainer',
  // ADR 0130/0133: a Infra elege uma das imagens candidatas do roteamento do
  // Arquiteto (`route_modules_to_infra`) e propõe subir o container REAL do
  // projeto, pelo broker — efeito externo de verdade (gasta infra), mesmo
  // calibre de `open_infra_pr`/`parallelize`. `maintainer` porque é quem
  // responde pelo projeto que autoriza o gasto.
  container_start: 'maintainer',
  // ADR 0136 (RN-495): mesma pergunta ("quem responde pelo projeto que
  // autoriza mexer na infra dele") — `maintainer` para as duas. A diferença
  // entre elas não é o PAPEL mínimo, é o teto absoluto logo abaixo: só
  // `container_remove` entra nele.
  container_stop: 'maintainer',
  container_remove: 'maintainer',
  // RN-506 (ADR 0145): MESMO calibre de `container_start` — quem responde
  // pelo projeto autoriza o gasto, seja ele elegido pela Infra (broker) ou
  // simplesmente subido pelo runner do usuário. Não entra em teto absoluto
  // nenhum, pelo mesmo raciocínio de `container_start`/`container_stop`:
  // não é o mais destrutivo dos quatro (essa régua é só de
  // `container_remove`).
  container_start_via_runner: 'maintainer',
};

// Rede de segurança padrão, sempre ativa, independente do permissions.json
// do projeto (que começa vazio pra todo projeto novo) — comandos
// catastroficamente destrutivos continuam negados mesmo sem nenhuma regra
// jamais configurada. Pequena e não-exaustiva de propósito: não é um
// sandbox, é só o piso mínimo de segurança do critério de aceite.
export const BUILTIN_DENY_PATTERNS: readonly string[] = [
  'Terminal(rm -rf /)',
  'Terminal(rm -rf /*)',
  'Terminal(rm -fr /)',
];

export interface DecideAction {
  actionType: ActionType;
  command?: string; // só usado (e obrigatório em espírito) pra actionType === 'terminal'
  targetBranch?: string; // só usado pra actionType === 'git_merge' (trava de merge)
  cwd?: string; // só usado pra actionType === 'terminal' (escopo de caminho)
}

export interface DecideContext {
  effectiveRole: Role | null;
  autonomyMode: PermissionPolicy | null;
  permissionsFile: PermissionsFile;
  /**
   * Raiz do projeto no disco (`<workspaces_root>/<projectId>`), quando
   * conhecida. AUSENTE mantém o comportamento anterior ao ADR 0055: sem
   * afrouxamento do `cd` e sem o teto de caminho. É o que permite existir
   * chamador que não sabe a raiz sem mudar o veredito dele.
   */
  projectScopeRoot?: string;
  /**
   * `true` quando o projeto está em `execution_mode: container` com uma
   * linha REGISTRADA em `project_containers` como `running` (ADR 0134,
   * RN-492) — `ProposeActionUseCase` é quem consulta
   * `ObterCicloDeVidaDoContainerUseCase` e monta este campo; `decide()`
   * continua puro, só lê o resultado. `true` NÃO confirma que o container
   * está de pé DE VERDADE agora (RN-486: registrado e observado nunca se
   * fundem) — é só o PISO inicial de `terminal`.
   *
   * Muda o valor INICIAL de `current` (abaixo) de `require_approval` para
   * `auto_approve` só para `actionType === 'terminal'`. Isso não é um teto
   * novo nem um atalho que pula estágio nenhum: é o mesmo `current` que já
   * existia, com um valor de partida diferente — `agent_autonomy` e
   * `permissions.json` continuam podendo REBAIXAR (ou manter) esse piso do
   * jeito que já rebaixam o default de hoje, e os tetos absolutos (escopo,
   * git push/comando privilegiado, merge protegido, instruction_patch,
   * paralelismo) continuam se aplicando por cima, byte a byte como estavam.
   * A justificativa de segurança de auto-aprovar aqui é que, DENTRO do
   * container, a fronteira real deixa de ser a checagem léxica de
   * `terminalNoEscopo` contra `projectScopeRoot` — vira o mount namespace do
   * Docker somado à validação de `/work` que o BROKER já faz
   * (`DiretorioForaDoEscopoError`, `apps/broker/src/operacoes.ts`) — e o
   * teto de escopo abaixo continua rodando por cima, como defesa em
   * profundidade, sobre os MESMOS caminhos de host de sempre (o `cwd`/
   * `command` que chegam aqui nunca são traduzidos para `/work` — essa
   * tradução acontece só depois, no engine, ao montar a chamada pro
   * broker).
   */
  containerExecutionActive?: boolean;
}

export interface Decision {
  policy: PermissionPolicy;
  reason: string;
}

/**
 * Pura — todo IO (papel efetivo, linha de agent_autonomy, leitura do
 * permissions.json) já aconteceu antes de chamar isto; `ctx` só carrega o
 * resultado. Avalia em ordem (a) IAM, (b) agent_autonomy, (c)
 * permissions.json — deny em qualquer estágio vence na hora. Cada estágio
 * só pode SUBIR a permissividade do anterior: um estágio "silencioso"
 * (sem opinião — sem linha de autonomy, ou nenhum padrão do arquivo bateu
 * num comando simples) nunca rebaixa o que um estágio anterior já decidiu.
 */
export function decide(action: DecideAction, ctx: DecideContext): Decision {
  const minRole = MIN_ROLE_FOR_ACTION_TYPE[action.actionType];
  if (!ctx.effectiveRole || !roleAtLeast(ctx.effectiveRole, minRole)) {
    return {
      policy: 'deny',
      reason: `IAM insuficiente: "${action.actionType}" exige papel >= ${minRole}`,
    };
  }

  // A FRONTEIRA DO CONTAINER e o COMANDO PRIVILEGIADO (ADR 0065, RN-106 —
  // revisados nesta entrega) DEIXARAM de ser barrados aqui, logo após o IAM.
  // Viraram teto absoluto, no bloco final junto dos outros (escopo, merge
  // protegido, instruction_patch, paralelismo) — ver o comentário lá embaixo
  // pra saber por que a mudança de `deny` pra `require_approval` incondicional
  // é segura.

  // O PISO de `terminal` DENTRO do container real do projeto (ADR 0134,
  // RN-492) — ver o docblock de `containerExecutionActive` em
  // `DecideContext` pra o raciocínio completo. Os estágios que seguem
  // (agent_autonomy, permissions.json, os tetos absolutos) tratam este
  // valor exatamente como tratavam o `require_approval` fixo de sempre:
  // podem rebaixá-lo, mantê-lo ou (não, no caso dos tetos) subi-lo.
  let current: Decision =
    action.actionType === 'terminal' && ctx.containerExecutionActive
      ? {
          policy: 'auto_approve',
          reason:
            'container: comando roda dentro do container real do projeto (ADR 0134) — ' +
            'a fronteira é o mount namespace do Docker, não o escopo léxico',
        }
      : {
          policy: 'require_approval',
          reason: 'default (sem regra aplicável)',
        };

  if (ctx.autonomyMode) {
    current = {
      policy: ctx.autonomyMode,
      reason: `agent_autonomy: ${ctx.autonomyMode}`,
    };
    if (current.policy === 'deny') return current;
  }

  const noEscopo = terminalNoEscopo(action, ctx);

  const fileVerdict = decideFromPermissionsFile(
    action,
    ctx.permissionsFile,
    noEscopo === true,
  );
  if (fileVerdict) {
    if (fileVerdict.policy === 'deny') return fileVerdict;
    current = fileVerdict;
  }

  // TETO DA FRONTEIRA DO CONTAINER + COMANDO PRIVILEGIADO (ADR 0065, RN-106
  // — revisado nesta entrega). `git push`, abertura de PR, deploy e
  // `sudo`/`doas` nunca são auto-aprováveis — nem por `agent_autonomy`
  // (inclusive o curinga `"*"` de "modo automático") nem por
  // `permissions.json`.
  //
  // Antes disto era `deny` incondicional logo após o IAM (ver o comentário
  // que sobrava lá em cima). Virou teto absoluto — `require_approval`, não
  // `deny` — pelo MESMO motivo que os tetos vizinhos já são assim: o produto
  // prefere que a ação exista como `proposed_action` pendente, auditável no
  // event log, decidida caso a caso, a recusá-la sem deixar rastro. Isso só é
  // seguro porque a fresta que o `deny` original tapava à força — "sempre
  // permitir" gravando o padrão em `allow` e abrindo a porta pra sempre — foi
  // fechada na FONTE: `ApproveAlwaysActionUseCase`/`patternForAction` recusam
  // gravar padrão pra ação com efeito externo git ou comando privilegiado
  // (ver approve-always-action.use-case.ts). Sem essa fresta fechada, este
  // teto viraria decorativo do mesmo jeito que os outros tetos alertam: um
  // clique bastaria pra reabrir a porta que ele diz fechar.
  //
  // git com efeito externo continua tendo ação TIPADA pra redirecionar
  // (`git_push`/`pr_open`/`git_merge`/`deploy`); `sudo`/`doas` não têm — a
  // mensagem só explica por que aquele comando pede decisão humana.
  if (action.actionType === 'terminal' && action.command) {
    const tokens = parseCommand(action.command);
    const efeito = efeitoExternoNoComando(tokens);
    const privilegiado = comandoPrivilegiadoNoComando(tokens);
    if ((efeito || privilegiado) && current.policy === 'auto_approve') {
      return {
        policy: 'require_approval',
        reason: efeito
          ? mensagemDeEfeitoExterno(efeito)
          : mensagemDeComandoPrivilegiado(privilegiado!),
      };
    }
  }

  // TETO DO ESCOPO DE CAMINHO (ADR 0055). Comando de terminal que toca
  // qualquer caminho FORA da pasta do projeto nunca é auto-aprovável, por mais
  // que o verbo esteja em `allow`.
  //
  // É o que fecha o achado U: o casamento do arquivo é por VERBO, então `cat`
  // liberado auto-aprovava `cat /workspace/apps/engine/.../git_executor.ex` —
  // o código da plataforma que executa o agente. Fora do escopo vira
  // `require_approval` e não `deny` de propósito: o agente pode ter razão
  // legítima para olhar fora, e quem decide continua sendo o usuário.
  if (noEscopo === false && current.policy === 'auto_approve') {
    return {
      policy: 'require_approval',
      reason:
        'escopo: o comando toca caminho fora da pasta do projeto — decisão do usuário',
    };
  }

  // TETO da trava de merge (Fase 4a): merge com destino em branch protegida
  // NUNCA é auto-aprovável — nem agent_autonomy nem permissions.json
  // conseguem promovê-lo pra auto_approve. Aplicado por ÚLTIMO, sobre o
  // veredito já calculado (deny já teria retornado antes; require_approval
  // permanece). Ver domain/actions/protected-branches.ts.
  if (
    action.actionType === 'git_merge' &&
    action.targetBranch !== undefined &&
    isProtectedBranch(action.targetBranch) &&
    current.policy === 'auto_approve'
  ) {
    return {
      policy: 'require_approval',
      reason:
        'trava de merge: destino em branch protegida nunca é auto-aprovável',
    };
  }

  // TETO do patch de instrução (Fase 4b): mudar a instrução de um agente
  // nunca é auto-aprovável — nem por agent_autonomy nem por
  // permissions.json. O valor da feature está no humano ver o diff e
  // decidir; auto-aprovar seria o agente reescrevendo a si mesmo.
  if (
    action.actionType === 'instruction_patch' &&
    current.policy === 'auto_approve'
  ) {
    return {
      policy: 'require_approval',
      reason:
        'patch de instrução nunca é auto-aprovável: o usuário precisa revisar o diff',
    };
  }

  // TETO do paralelismo (FASE 14d): as duas ações que mexem em QUANTO o
  // produto pode gastar sozinho nunca são auto-aprováveis.
  //
  // Sem isto o teto seria decorativo: um `permissions.json` com
  // `parallelize: auto_approve` faria toda ultrapassagem se aprovar sozinha, e
  // a regra que existe para exigir sua decisão passaria a dispensá-la. O
  // `raise_max_parallel` é pior ainda — seria o produto elevando o próprio
  // teto, que é exatamente o que o pipeline de aprovação existe para impedir.
  //
  // `propose_execution_plan` (ADR 0086) foi CONSIDERADO para este bloco e
  // DELIBERADAMENTE deixado fora — não é esquecimento. Os três tetos
  // absolutos que o CLAUDE.md enumera (merge protegido, instruction_patch,
  // parallelize/raise_max_parallel) são os pontos em que o produto recusa
  // deixar o usuário automatizar a própria decisão, mesmo com "sempre
  // permitir" configurado. O plano do Dev Lead é diferente: é a PRIMEIRA
  // vez que o usuário decide quantos agentes sobem numa sessão, não uma
  // ultrapassagem de um teto já autorizado — e nada nesta feature pede um
  // quarto absoluto. Fica `require_approval` por padrão (via IAM +
  // ausência de regra em `permissions.json`), mas o usuário PODE configurar
  // auto-aprovação explícita, como já vale para `open_adr_pr`/
  // `open_infra_pr`.
  //
  // `assess_implementability` (ADR 0090) segue o MESMO raciocínio de
  // `propose_execution_plan`, pelo mesmo motivo: é um parecer inicial
  // sobre uma story, não uma ultrapassagem de teto já autorizado.
  //
  // `container_start` (ADR 0130/0133) segue o MESMO raciocínio pela MESMA
  // razão, com uma nuance: não é a Infra ultrapassando um teto já
  // autorizado, é a PRIMEIRA vez que um container sobe de verdade para esta
  // eleição — decisão inicial, não reincidência. Fica `require_approval`
  // por padrão (não está semeado em `INFRA_AUTONOMY_SEEDS`, ao contrário de
  // `open_infra_pr`: aqui o efeito é real, gasta infra, e a Infra nunca
  // recebe auto-aprovação de propósito), mas nada o impede de ser
  // configurado como auto-aprovável, como `open_adr_pr`/`open_infra_pr` já
  // são.
  if (
    (action.actionType === 'parallelize' ||
      action.actionType === 'raise_max_parallel') &&
    current.policy === 'auto_approve'
  ) {
    return {
      policy: 'require_approval',
      reason:
        'gastar com mais agentes nunca é auto-aprovável: quem decide subir o teto é você',
    };
  }

  // TETO de `container_remove` (ADR 0136, RN-495) — no MESMO calibre do teto
  // de git push/comando privilegiado (RN-418): nunca auto-aprovável, nem por
  // agent_autonomy nem por permissions.json, e `ApproveAlwaysActionUseCase`
  // recusa gravar o padrão pra ele (mesma fechadura da fonte que RN-418 já
  // usa). A diferença de `container_start`/`container_stop` — que PODEM ser
  // configurados como auto-aprováveis, mesmo nunca semeados — não é o papel
  // mínimo (os três são `maintainer`), é o que a ação FAZ: descartar o
  // container é a única das três que joga fora o que existe e exige
  // reprovisionar do zero (container-lifecycle.ts, `removed` só sai
  // provisionando de novo). O produto trata isso como o mesmo calibre de
  // merge em branch protegida — decisão que o usuário toma a cada vez, nunca
  // uma vez só configurando o arquivo.
  if (
    action.actionType === 'container_remove' &&
    current.policy === 'auto_approve'
  ) {
    return {
      policy: 'require_approval',
      reason:
        'remover o container nunca é auto-aprovável: descarta o que existe e ' +
        'exige reprovisionar do zero — decisão do usuário a cada vez',
    };
  }

  return current;
}

/**
 * O comando de terminal está inteiramente dentro da pasta do projeto?
 *
 * `null` = não dá para dizer (não é terminal, ou o chamador não informou a
 * raiz). Os três estados são de propósito: `null` não afrouxa nem aperta nada,
 * o que mantém o comportamento anterior ao ADR 0055 para quem não passa a raiz.
 */
function terminalNoEscopo(
  action: DecideAction,
  ctx: DecideContext,
): boolean | null {
  if (action.actionType !== 'terminal' || !ctx.projectScopeRoot) return null;
  if (!action.command) return null;

  return comandoNoEscopo(
    parseCommand(action.command),
    action.cwd,
    ctx.projectScopeRoot,
  );
}

/** `cd` para dentro do escopo é a própria declaração de escopo, não um verbo. */
function ehCdNoEscopo(tokens: string[]): boolean {
  return tokens[0] === 'cd';
}

function decideFromPermissionsFile(
  action: DecideAction,
  file: PermissionsFile,
  noEscopo: boolean,
): Decision | null {
  const segments =
    action.actionType === 'terminal' && action.command
      ? parseCommand(action.command)
      : [[]];

  const perSegment = segments.map((tokens) => {
    const veredito = matchAgainstFile(action.actionType, tokens, file);
    if (veredito) return veredito;

    // Dentro do escopo, um `cd` sem regra deixa de reprovar o comando composto
    // (ADR 0055). Era o defeito mais caro da escada: o dev agent emite SEMPRE
    // `cd <caminho> && <verbo>`, `cd` não está em allow nenhum, e comando
    // composto exige que TODOS os segmentos casem — então o allow semeado
    // quase nunca era alcançado e cada comando parava para aprovação.
    //
    // Só vale com o escopo já verificado: `comandoNoEscopo` conferiu que o
    // destino do `cd` está dentro da pasta do projeto. Fora dela, o `cd`
    // continua sem regra e o comando continua indo para o usuário.
    if (noEscopo && ehCdNoEscopo(tokens)) {
      return {
        policy: 'auto_approve' as const,
        reason: 'escopo: cd dentro da pasta do projeto',
      };
    }

    return null;
  });

  const denyHit = perSegment.find((v) => v?.policy === 'deny');
  if (denyHit) return denyHit;

  if (segments.length > 1) {
    // Comando composto: um segmento sem regra nenhuma vira uma opinião
    // CONCRETA de require_approval (nunca silêncio) — é isso que impede
    // um allow parcial (só o primeiro pedaço aprovado) de promover o
    // comando inteiro pra auto_approve.
    const allAllow = perSegment.every((v) => v?.policy === 'auto_approve');
    if (allAllow) {
      return {
        policy: 'auto_approve',
        reason:
          'permissions.json: todos os segmentos do comando composto batem em allow',
      };
    }
    return {
      policy: 'require_approval',
      reason:
        'permissions.json: comando composto com ao menos um segmento não coberto por allow',
    };
  }

  return perSegment[0] ?? null;
}

function matchAgainstFile(
  actionType: ActionType,
  tokens: string[],
  file: PermissionsFile,
): Decision | null {
  const label = tokens.length > 0 ? tokens.join(' ') : actionType;
  const effectiveDeny = [...BUILTIN_DENY_PATTERNS, ...file.deny];

  if (effectiveDeny.some((p) => matchesPattern(p, actionType, tokens))) {
    return { policy: 'deny', reason: `permissions.json deny: ${label}` };
  }
  if (file.allow.some((p) => matchesPattern(p, actionType, tokens))) {
    return {
      policy: 'auto_approve',
      reason: `permissions.json allow: ${label}`,
    };
  }
  if (file.ask.some((p) => matchesPattern(p, actionType, tokens))) {
    return {
      policy: 'require_approval',
      reason: `permissions.json ask: ${label}`,
    };
  }
  return null;
}
