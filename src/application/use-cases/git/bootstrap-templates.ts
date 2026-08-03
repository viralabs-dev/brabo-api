// Conteúdo gerado pelo bootstrap de Gitflow — funções puras de
// template-string, sem engine nenhuma. Caminho de template de PR
// padronizado pros 3 providers (mesmo pro GitLab, cuja convenção real
// seria `.gitlab/merge_request_templates/Default.md`) — simplificação
// deliberada, ver docs/adr/0005.

export const PR_TEMPLATE_PATH = '.github/pull_request_template.md';
export const BRANCHING_POLICY_PATH = 'docs/branching-policy.md';

export function prTemplateContent(): string {
  return `## O que muda

Descreva o que essa mudança faz e por quê.

## Checklist

- [ ] Testado localmente
- [ ] Sem segredos/credenciais no diff
- [ ] Testes cobrindo o caminho feliz + 1 caso de falha (quando aplicável)
`;
}

// A escada tem TRÊS degraus, não quatro. Havia um `rc` (release candidate)
// entre `qa` e `main`, e o ADR 0030 o removeu: sem ambiente e sem gente para
// exercê-lo, era degrau cerimonial. O `pr-police` do CI já operava com três
// desde então — este texto, que o bootstrap COMMITA no repositório do
// usuário, era o último lugar que ainda ensinava a política antiga (achado #3
// do primeiro dogfooding).
export function branchingPolicyContent(): string {
  return `# Política de branching

Gerado automaticamente pelo bootstrap de Gitflow — branches permanentes:

- \`main\` — produção. Só recebe merge de \`qa\`.
- \`qa\` — recebe merge de \`dev\` pra validação antes de ir pra produção.
- \`dev\` — integração contínua do trabalho em andamento. Todo
  \`feature/*\` nasce a partir daqui.

Trabalho novo sempre em \`feature/*\` a partir de \`dev\`, nunca direto
nas branches permanentes. Correção urgente nasce de \`main\` como
\`hotfix/*\` e volta pra \`main\`.
`;
}
