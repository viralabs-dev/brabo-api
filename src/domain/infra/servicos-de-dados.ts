/**
 * RN-1537 (AT-1015, ADR 0299): o serviço de dados nunca sobe como root sob
 * `--cap-drop ALL` (o `gosu` do postgres é negado). Para imagem CONHECIDA e
 * MEDIDA, o Brabo completa `user` e `tmpfs` do serviço; para outra, a Infra
 * declara `user` ou a proposta volta a ela (400 `servico_sem_usuario`).
 *
 * Só entra na tabela o que foi medido: postgres debian 999:999 (condutor,
 * TP-01 31ª) e alpine 70:70 (RN-941), dados em `/var/lib/postgresql/data`.
 * `postgres:18+` mudou o PGDATA e `mysql`, `mariadb`, `mongo` e `redis` não
 * foram medidos: ficam de fora até o teste de corrente medi-los.
 * Tudo aqui é PURO.
 */
import type { Run, ServicoDeQa } from './run-instructions';

const DADOS_DO_POSTGRES = '/var/lib/postgresql/data';
const POSTGRES_ATE_A_MAIOR = 17;

interface Completo {
  user: string;
  tmpfs: string[];
}

/** `postgres[:<major>[.<minor>][-<variante>]]@sha256:...`; `null` fora da tabela. */
export function dadosConhecidosDaImagem(imagem: string): Completo | null {
  const m =
    /^(?:docker\.io\/)?(?:library\/)?postgres:(\d+)(?:\.\d+)*(-[a-z0-9.-]+)?(?:@sha256:[0-9a-f]{64})?$/.exec(
      imagem,
    );
  if (!m || Number(m[1]) > POSTGRES_ATE_A_MAIOR) return null;
  return {
    user: m[2]?.includes('alpine') ? '70:70' : '999:999',
    tmpfs: [DADOS_DO_POSTGRES],
  };
}

function completar(s: ServicoDeQa): ServicoDeQa {
  if (typeof s?.image !== 'string') return s;
  const conhecido = dadosConhecidosDaImagem(s.image);
  if (!conhecido) return s;
  const user = s.user ?? conhecido.user;
  const tmpfs = s.tmpfs ?? conhecido.tmpfs;
  return user === s.user && tmpfs === s.tmpfs ? s : { ...s, user, tmpfs };
}

/**
 * Completa `user`/`tmpfs` dos serviços de imagem conhecida. Tolerante a `run`
 * malformado (devolve o MESMO objeto; a régua é `recusaDoRun`). Devolve o
 * mesmo objeto quando nada muda.
 */
export function completarServicosDeDados<T>(run: T): T {
  const servicos = (run as { qa?: { services?: unknown } } | null)?.qa
    ?.services;
  if (!Array.isArray(servicos)) return run;
  const novos = (servicos as ServicoDeQa[]).map(completar);
  if (novos.every((s, i) => s === servicos[i])) return run;
  return { ...run, qa: { ...(run as Run).qa, services: novos } };
}

/** Só chame com `run` já válido. Serviço fora da tabela e sem `user` é recusa. */
export function recusaDeServicoSemUsuario(run: unknown): string | null {
  for (const s of (run as Run).qa?.services ?? []) {
    if (s.user == null) {
      return `O serviço "${s.name}" usa a imagem "${s.image.split('@')[0]}", que o Brabo não sabe rodar sem root. Declare \`user\` ("<uid>:<gid>", diferente de 0) e \`tmpfs\` com o diretório de dados desse serviço em \`run.qa.services\`.`;
    }
  }
  return null;
}
