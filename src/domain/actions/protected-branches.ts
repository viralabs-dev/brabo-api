// Branches permanentes/protegidas (CLAUDE.md). Merge com destino numa dessas é
// SEMPRE manual do usuário — nunca auto-aprovável (ver decide.ts, o teto da
// trava de merge). Pura, sem IO.
//
// `rc` continua aqui DE PROPÓSITO, mesmo depois de o degrau sair da política
// (ADR 0030) e de o bootstrap parar de criá-la (achado #3). Esta lista decide
// o que a trava de merge RECUSA, e repositórios bootstrapados por versões
// anteriores ainda têm a branch: tirá-la daqui trocaria um degrau cerimonial
// por um merge auto-aprovável numa branch que alguém pode estar usando como
// produção. Proteger uma branch que não existe não custa nada; desproteger
// uma que existe custa caro.
export const PROTECTED_BRANCHES = ['dev', 'qa', 'rc', 'main'] as const;

export function isProtectedBranch(branch: string): boolean {
  return (PROTECTED_BRANCHES as readonly string[]).includes(branch);
}
