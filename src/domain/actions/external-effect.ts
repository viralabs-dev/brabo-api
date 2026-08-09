/**
 * A fronteira do container (ADR 0065): o que é DENTRO e o que é FORA.
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
 * devem ser humanas"*.
 *
 * ## Por que `deny` no terminal, e não `require_approval`
 *
 * Cada um desses efeitos JÁ tem um caminho tipado — `git_push`, `pr_open`,
 * `git_merge` — que nasce `proposed_action`, tem papel mínimo próprio, é
 * executado pela plataforma e fica no event log com o que foi empurrado e para
 * onde. O terminal é uma SEGUNDA porta para o mesmo efeito, e uma porta sem
 * nenhuma dessas garantias: o event log registraria "um comando rodou", não
 * "esta branch foi empurrada".
 *
 * `require_approval` não bastaria porque o produto tem "sempre permitir", que
 * grava o padrão em `allow` — bastaria um clique para a segunda porta ficar
 * aberta para sempre. `deny` vence `allow` em qualquer estágio (ver
 * `decide.ts`), e é por isso que ele é a forma certa desta regra: não é uma
 * preferência configurável, é a fronteira.
 *
 * Negar aqui não tira poder do agente — redireciona: a mensagem diz qual ação
 * tipada usar. Foi assim que o dev agent sempre fez, aliás (`agent_io.ex`
 * propõe `git_push`); o que muda é que agora está garantido, e não só
 * combinado.
 *
 * ## Por que a lista pode ser curta sem ser um allowlist
 *
 * Esta lista NÃO tenta enumerar tudo que é perigoso — essa é justamente a
 * tentativa que os achados Z e AD provaram não convergir. Ela enumera os três
 * efeitos que a constituição do produto declara humanos, e o container cuida
 * do resto: sem rede (`network: none`, o default do artefato do Arquiteto), um
 * `curl | sh` não alcança nada, e um verbo destrutivo destrói o container
 * descartável do projeto, não o host.
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
