import type { AuthEventParaGravar } from '../../domain/auth/auth-event';

/**
 * Trilha de auth — APPEND-ONLY.
 *
 * A porta tem só `registrar`. Não existe `atualizar` nem `apagar`, e essa
 * ausência é a garantia: igual a `SessionEventRepository`, a imutabilidade
 * está no contrato, não num trigger (o schema deste repositório não tem
 * nenhum). Quem precisar de estado que muda usa outra tabela — foi
 * exatamente por isso que a janela do lockout virou `auth_lockout_hits`.
 */
export abstract class AuthEventRecorder {
  abstract registrar(evento: AuthEventParaGravar): Promise<void>;
}
