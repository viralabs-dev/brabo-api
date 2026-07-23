// Hierarquia linear: cada papel inclui as permissões dos papéis à
// direita. owner > maintainer > developer > viewer.
export const ROLE_ORDER = [
  'viewer',
  'developer',
  'maintainer',
  'owner',
] as const;

export type Role = (typeof ROLE_ORDER)[number];

export function roleAtLeast(effective: Role, required: Role): boolean {
  return ROLE_ORDER.indexOf(effective) >= ROLE_ORDER.indexOf(required);
}
