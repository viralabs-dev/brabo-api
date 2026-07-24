// Branches permanentes/protegidas (CLAUDE.md). Merge com destino numa dessas é
// SEMPRE manual do usuário — nunca auto-aprovável (ver decide.ts, o teto da
// trava de merge). Pura, sem IO.
export const PROTECTED_BRANCHES = ['dev', 'qa', 'rc', 'main'] as const;

export function isProtectedBranch(branch: string): boolean {
  return (PROTECTED_BRANCHES as readonly string[]).includes(branch);
}
