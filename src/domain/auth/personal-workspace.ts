/**
 * Nome e slug do workspace pessoal que nasce junto com toda conta NOVA
 * (RN-410) — usuário sem workspace nenhum não consegue usar o produto: o
 * botão "Novo projeto" do dashboard não faz nada visível quando
 * `useCurrentWorkspace()` não acha nenhum.
 *
 * Os DOIS pontos que criam conta nova — `RegisterUseCase` (e-mail/senha) e
 * `SocialLoginCallbackUseCase` (login social, no ramo que provisiona conta
 * nova) — chamam esta MESMA função, para a regra de nome/slug não divergir
 * em dois arquivos.
 *
 * ## Por que o slug sempre leva um pedaço do id
 *
 * `workspaces.slug` é `UNIQUE` no banco, e nada no produto faz
 * retry-on-conflict de slug. Dois cadastros com o mesmo nome ("Maria") ou o
 * mesmo local-part de e-mail (dois "maria@" em domínios diferentes)
 * colidiriam. O sufixo com os 8 primeiros caracteres do `userId` — mesmo
 * padrão de `extraDevAgentId`/`workspaceDirName`/rótulo de sessão
 * (`slice(0, 8)`) — torna o slug único por CONSTRUÇÃO, sem round-trip extra
 * ao banco para checar disponibilidade.
 */
export function nomeESlugDoWorkspacePessoal(
  nome: string | null | undefined,
  email: string,
  userId: string,
): { name: string; slug: string } {
  const base = nome?.trim() || localPartDoEmail(email);
  const name = `Workspace de ${base}`;
  const slugBase = kebab(base) || 'workspace';
  const slug = `${slugBase}-${userId.slice(0, 8)}`;
  return { name, slug };
}

function localPartDoEmail(email: string): string {
  const [local] = email.split('@');
  return local || email;
}

/** Kebab-case tolerante a acento — mesma forma de `apps/web/src/lib/wizard.ts`. */
function kebab(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
