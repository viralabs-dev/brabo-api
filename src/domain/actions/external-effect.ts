/**
 * A fronteira do container (ADR 0065) e o comando privilegiado: o que é
 * DENTRO e o que é FORA, e o que eleva privilégio no host.
 *
 * ## O problema
 *
 * A FASE 25 troca a fronteira de POLÍTICA por ISOLAMENTO: cada projeto ganha
 * container próprio e, dentro dele, o agente é livre — ler, escrever,
 * instalar, buildar, testar, rodar. Isso é o que fecha os achados Z e AD, em
 * que o allowlist de verbos não convergia porque verbo, forma e invocação são
 * espaços distintos.
 *
 * Só que "livre dentro" não pode virar "livre fora". Três efeitos atravessam a
 * parede do container e chegam no mundo — `git push`, abertura de PR e deploy
 * — e o usuário foi textual sobre eles: *"agente livre para o que quiser desde
 * que não seja comandos de git ligado ao deploy e ao PR — estas ações ainda
 * devem ser humanas"*. `sudo`/`doas` entraram depois, pelo mesmo pedido
 * textual, agora estendido a QUALQUER comando que eleve privilégio: também
 * SEMPRE humano, mesmo com "modo automático" ligado.
 *
 * ## Por que TETO ABSOLUTO em `decide()`, e não mais `deny` aqui
 *
 * Cada efeito de git JÁ tem um caminho tipado — `git_push`, `pr_open`,
 * `git_merge` — que nasce `proposed_action`, tem papel mínimo próprio, é
 * executado pela plataforma e fica no event log com o que foi empurrado e para
 * onde. O terminal é uma SEGUNDA porta para o mesmo efeito. `sudo`/`doas` não
 * têm ação tipada equivalente — não há "para onde redirecionar", o comando
 * privilegiado É o comando, só que decidido por um humano toda vez.
 *
 * Esta função só DETECTA — quem decide a política é `decide.ts`, no bloco dos
 * tetos absolutos (mesma forma de merge protegido/`instruction_patch`/
 * paralelismo): `require_approval` incondicional, mesmo com `agent_autonomy`
 * no curinga `"*"` em `auto_approve` ou um `allow` de `permissions.json` que
 * casaria. Isto DEIXOU de ser `deny` (ver o histórico deste arquivo/ADR 0065
 * para a versão anterior): "sempre permitir" gravaria o padrão em `allow` e a
 * segunda porta ficaria aberta pra sempre — mas essa fresta foi fechada na
 * FONTE (`pattern-for-action.ts`/`ApproveAlwaysActionUseCase` recusam gravar
 * padrão pra comando com efeito externo ou privilegiado), então o teto pode
 * ser a forma mais informativa (`proposed_action` pendente, no event log,
 * decisão caso a caso) sem reabrir o buraco que o `deny` original existia
 * pra tapar.
 *
 * Negar aqui não tira poder do agente — a mensagem de efeito externo
 * redireciona: diz qual ação tipada usar. Foi assim que o dev agent sempre
 * fez, aliás (`agent_io.ex` propõe `git_push`); o que muda é que agora está
 * garantido, e não só combinado. `sudo`/`doas` não redirecionam pra lugar
 * nenhum — a mensagem só explica por que aquele comando específico pede
 * decisão humana.
 *
 * ## Por que a lista pode ser curta sem ser um allowlist
 *
 * Esta lista NÃO tenta enumerar tudo que é perigoso — essa é justamente a
 * tentativa que os achados Z e AD provaram não convergir. Ela enumera os
 * efeitos que a constituição do produto declara sempre humanos, e o
 * container cuida do resto: sem rede (`network: none`, o default do artefato
 * do Arquiteto), um `curl | sh` não alcança nada, e um verbo destrutivo
 * destrói o container descartável do projeto, não o host.
 *
 * Puro, sem IO.
 */

export interface EfeitoExterno {
  /** Como o comando pediu o efeito, para a mensagem. */
  comando: string;
  /** A ação tipada que É o caminho legítimo do mesmo efeito. */
  acaoTipada: string;
  motivo: string;
}

interface Regra {
  /** Prefixo de tokens. `['git', 'push']` casa `git push origin main`. */
  prefixo: string[];
  acaoTipada: string;
  motivo: string;
}

const EMPURRAR_CODIGO =
  'empurrar código para o remoto atravessa o container e chega no repositório do usuário';
const ABRIR_PR =
  'abrir PR é pedir revisão humana: a ação tipada é o que registra a PR no event log';
const DEPLOY =
  'deploy publica no mundo — a fronteira do container termina aqui, e a decisão é sua';

/**
 * As regras, por prefixo de tokens.
 *
 * `git push` e não `git`: o agente lê `git status`, `git log` e `git diff` o
 * tempo todo dentro do worktree, e são leituras que nunca saem da parede.
 *
 * `git remote add`/`set-url` entram porque reapontar o `origin` é como se
 * contorna a regra sem escrever a palavra `push` — mas `git remote -v`, que é
 * leitura, fica de fora. `git merge` entra por causa da RN-014: merge em
 * branch protegida é sempre manual, e um `git merge` local seguido de push
 * seria o caminho de fora dela.
 */
const REGRAS: readonly Regra[] = [
  { prefixo: ['git', 'push'], acaoTipada: 'git_push', motivo: EMPURRAR_CODIGO },
  {
    prefixo: ['git', 'remote', 'add'],
    acaoTipada: 'git_push',
    motivo:
      'trocar o remoto é trocar para ONDE o código vai — decidir isso é decidir o push',
  },
  {
    prefixo: ['git', 'remote', 'set-url'],
    acaoTipada: 'git_push',
    motivo:
      'trocar o remoto é trocar para ONDE o código vai — decidir isso é decidir o push',
  },
  {
    prefixo: ['git', 'merge'],
    acaoTipada: 'git_merge',
    motivo: EMPURRAR_CODIGO,
  },
  {
    prefixo: ['git', 'subtree', 'push'],
    acaoTipada: 'git_push',
    motivo: EMPURRAR_CODIGO,
  },
  // CLIs de provider. São a forma "sem git" de abrir PR e de empurrar.
  { prefixo: ['gh', 'pr', 'create'], acaoTipada: 'pr_open', motivo: ABRIR_PR },
  { prefixo: ['gh', 'pr', 'merge'], acaoTipada: 'git_merge', motivo: ABRIR_PR },
  {
    prefixo: ['gh', 'release', 'create'],
    acaoTipada: 'deploy',
    motivo: DEPLOY,
  },
  { prefixo: ['gh', 'workflow', 'run'], acaoTipada: 'deploy', motivo: DEPLOY },
  {
    prefixo: ['glab', 'mr', 'create'],
    acaoTipada: 'pr_open',
    motivo: ABRIR_PR,
  },
  {
    prefixo: ['glab', 'mr', 'merge'],
    acaoTipada: 'git_merge',
    motivo: ABRIR_PR,
  },
  {
    prefixo: ['glab', 'release', 'create'],
    acaoTipada: 'deploy',
    motivo: DEPLOY,
  },
  // Deploy. Estes não têm ação tipada ainda (DEPLOY_ENABLED está no backlog),
  // e é exatamente por isso que a resposta é "não daqui": um efeito de mundo
  // sem pipeline de aprovação não pode ter atalho por terminal.
  { prefixo: ['kubectl', 'apply'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['kubectl', 'delete'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['kubectl', 'rollout'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['helm', 'install'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['helm', 'upgrade'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['terraform', 'apply'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['terraform', 'destroy'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['docker', 'push'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['npm', 'publish'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['pnpm', 'publish'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['flyctl', 'deploy'], acaoTipada: 'deploy', motivo: DEPLOY },
  { prefixo: ['fly', 'deploy'], acaoTipada: 'deploy', motivo: DEPLOY },
];

/**
 * O primeiro efeito externo encontrado em QUALQUER segmento, ou `null`.
 *
 * Varre todos os segmentos pelo mesmo princípio do `deny` de comando composto:
 * `pnpm test && git push` é um comando que empurra, e casar só o primeiro
 * segmento seria a fresta pela qual ele passaria.
 */
export function efeitoExternoNoComando(
  segmentos: string[][],
): EfeitoExterno | null {
  for (const tokens of segmentos) {
    const regra = REGRAS.find((r) => casaPrefixo(r.prefixo, tokens));
    if (regra) {
      return {
        comando: regra.prefixo.join(' '),
        acaoTipada: regra.acaoTipada,
        motivo: regra.motivo,
      };
    }
  }
  return null;
}

/**
 * Casa o prefixo IGNORANDO flags globais que vêm antes do subcomando —
 * `git -C /tmp push` é um push, e olhar só as duas primeiras posições o
 * deixaria passar.
 *
 * A varredura é do verbo (posição 0, que tem de casar exato) e depois procura
 * o resto do prefixo NA ORDEM entre os tokens seguintes. Isso aceita
 * `git --no-pager push`, e não aceita `git push-nada` (casamento é por token
 * inteiro) nem `pnpm run push` (o `push` ali é nome de script, e o verbo do
 * prefixo `git push` não casou).
 *
 * **Flag com valor.** `-C /tmp` é dois tokens, e só o primeiro parece flag —
 * `/tmp` não começa com `-` e derrubaria o casamento se fosse tratado como
 * "token estranho no meio". A regra: depois de um token-flag, se o PRÓXIMO
 * token não é o pedaço de prefixo esperado nem outra flag, ele é o VALOR da
 * flag anterior e também é pulado. O lado que isto favorece é deliberado —
 * esta função existe para BLOQUEAR efeito externo, então casar demais é o erro
 * seguro; casar de menos deixaria um `git -C /tmp push` passar batido.
 */
function casaPrefixo(prefixo: string[], tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (tokens[0] !== prefixo[0]) return false;

  let alvo = 1;
  let i = 1;
  while (i < tokens.length && alvo < prefixo.length) {
    if (tokens[i] === prefixo[alvo]) {
      alvo += 1;
      i += 1;
      continue;
    }
    if (!tokens[i].startsWith('-')) return false;
    i += 1;
    const valor = tokens[i];
    if (
      valor !== undefined &&
      valor !== prefixo[alvo] &&
      !valor.startsWith('-')
    ) {
      i += 1;
    }
  }
  return alvo === prefixo.length;
}

/** A mensagem que o agente lê. Diz o que fazer, não só o que não fazer. */
export function mensagemDeEfeitoExterno(efeito: EfeitoExterno): string {
  return (
    `fronteira do container: "${efeito.comando}" não sai pelo terminal — ` +
    `${efeito.motivo}. Use a ação tipada \`${efeito.acaoTipada}\`, que nasce ` +
    `proposed_action e passa pela decisão do usuário.`
  );
}

export interface ComandoPrivilegiado {
  /** O verbo que elevou privilégio (`sudo` ou `doas`), para a mensagem. */
  comando: string;
  motivo: string;
}

/**
 * Verbos que elevam privilégio no host. Categoria PRÓPRIA, separada de
 * `REGRAS` (efeito externo git/PR/deploy): não têm ação tipada equivalente —
 * não há "para onde redirecionar", o comando privilegiado É o comando, só
 * que sempre decidido por um humano. `decide()` pergunta pelas duas
 * categorias juntas (`efeitoExternoNoComando` OU `comandoPrivilegiadoNoComando`)
 * no mesmo bloco de teto absoluto.
 */
const VERBOS_PRIVILEGIADOS: readonly string[] = ['sudo', 'doas'];

const ELEVA_PRIVILEGIO =
  'eleva privilégio no host — decisão sempre humana, mesmo com "modo automático" ligado';

/**
 * O primeiro comando privilegiado encontrado em QUALQUER segmento, ou
 * `null`. Mesma varredura de `efeitoExternoNoComando`: `pnpm test && sudo
 * rm -rf /` é um comando que eleva privilégio, e casar só o primeiro
 * segmento seria a fresta pela qual ele passaria.
 *
 * Casamento é pelo VERBO (primeiro token do segmento) — `sudo -u root apt
 * install x` casa; um argumento que só CONTÉM a palavra `sudo` no meio
 * (ex.: `echo sudo`) não casa, porque `sudo` ali não é o verbo do segmento.
 */
export function comandoPrivilegiadoNoComando(
  segmentos: string[][],
): ComandoPrivilegiado | null {
  for (const tokens of segmentos) {
    if (tokens.length === 0) continue;
    if (VERBOS_PRIVILEGIADOS.includes(tokens[0])) {
      return { comando: tokens[0], motivo: ELEVA_PRIVILEGIO };
    }
  }
  return null;
}

/**
 * A mensagem que o agente lê pra comando privilegiado. Diferente de
 * `mensagemDeEfeitoExterno`, não redireciona pra ação tipada — não existe
 * uma: só explica por que aquele comando específico pede decisão humana.
 */
export function mensagemDeComandoPrivilegiado(
  cmd: ComandoPrivilegiado,
): string {
  return (
    `comando privilegiado: "${cmd.comando}" ${cmd.motivo}. Vira ` +
    `proposed_action pendente — o usuário decide caso a caso.`
  );
}

/**
 * A OUTRA metade do teto absoluto (ver decide.ts): sem isto, "sempre
 * permitir" gravaria `Terminal(git push)`/`Terminal(sudo)` em
 * `permissions.json`/`allow`, e a próxima proposta do MESMO comando
 * auto-aprovaria — reabrindo a porta que o teto de `decide()` existe pra
 * manter fechada. `ApproveAlwaysActionUseCase` chama isto ANTES de gravar
 * qualquer padrão; `null` significa "pode gravar normalmente".
 *
 * Mensagem endereçada ao USUÁRIO que clicou "sempre permitir" (tom
 * diferente de `mensagemDeEfeitoExterno`/`mensagemDeComandoPrivilegiado`,
 * que falam com o agente) — explica por que nada foi gravado e o que fazer
 * em vez disso.
 */
export function motivoDeRecusaSempreAprovar(
  segmentos: string[][],
): string | null {
  const efeito = efeitoExternoNoComando(segmentos);
  if (efeito) {
    return (
      `"sempre permitir" não grava padrão pra "${efeito.comando}": ` +
      `${efeito.motivo}. Esta ação nasce SEMPRE proposed_action pendente — ` +
      `aprove só esta instância pelo fluxo normal de aprovação.`
    );
  }
  const privilegiado = comandoPrivilegiadoNoComando(segmentos);
  if (privilegiado) {
    return (
      `"sempre permitir" não grava padrão pra "${privilegiado.comando}": ` +
      `${privilegiado.motivo}. Esta ação nasce SEMPRE proposed_action ` +
      `pendente — aprove só esta instância pelo fluxo normal de aprovação.`
    );
  }
  return null;
}
