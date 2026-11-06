import type { SessionEventRepository } from '../../ports/session-event-repository.port';

export const EVENTO_REGRA_RETIRADA = 'artifact.business_rule_retired';

/**
 * RN-1018: os ids das regras de negócio RETIRADAS do projeto. A regra segue no
 * log (evento é imutável); quem LÊ para decidir (listar, cobertura, duplicata,
 * contexto do dev, aceite) tira estes ids da conta.
 */
export async function idsDeRegrasRetiradas(
  eventos: Pick<SessionEventRepository, 'listByTypeForProject'>,
  projectId: string,
): Promise<Set<string>> {
  const retiradas = await eventos.listByTypeForProject(
    projectId,
    EVENTO_REGRA_RETIRADA,
  );
  return new Set(
    retiradas.flatMap((e) => {
      const id = (e.payload as { ruleId?: unknown } | null)?.ruleId;
      return typeof id === 'string' ? [id] : [];
    }),
  );
}
