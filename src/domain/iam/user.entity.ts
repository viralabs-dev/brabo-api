export interface User {
  id: string;
  keycloakSub: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}
