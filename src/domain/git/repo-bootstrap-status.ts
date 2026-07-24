import { BOOTSTRAP_STEPS, type RepoBootstrap } from './repo-bootstrap.entity';

const LAST_STEP = BOOTSTRAP_STEPS[BOOTSTRAP_STEPS.length - 1];

export type ProvisioningStatus =
  'provisioning' | 'provisioned' | 'provision_failed';

/**
 * Puro, sem IO — deriva o status de provisionamento do PROJETO a partir
 * do cursor de bootstrap, em vez de persistir um status redundante (ver
 * mesma filosofia de domain/actions/action-state-machine.ts).
 */
export function deriveProvisioningStatus(
  row: RepoBootstrap | null,
): ProvisioningStatus | null {
  if (!row) return null;
  if (row.status === 'failed') return 'provision_failed';
  if (row.step === LAST_STEP && row.status === 'done') {
    return 'provisioned';
  }
  return 'provisioning';
}
