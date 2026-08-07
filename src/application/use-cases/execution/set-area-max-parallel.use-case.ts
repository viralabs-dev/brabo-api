import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';

/**
 * O teto de paralelismo de uma área, decidido pelo usuário (FASE 14d, item 3).
 *
 * O default é `2` e vive no schema. Isto é a única forma de mudá-lo — não há
 * caminho automático, e é de propósito: o teto é o que separa "o lead decide"
 * de "o lead gasta". Um produto que sobe o próprio teto de gasto é exatamente
 * o que o pipeline de aprovação existe para impedir.
 *
 * A Anamnese pode PROPOR subi-lo quando notar que a autorização é recorrente
 * (item 4), e a proposta continua passando por aqui depois de você aceitar.
 *
 * **Não emite evento**, seguindo a promoção de história (Fase 12c): o event
 * log é escopado por SESSÃO e mudar configuração de projeto não tem sessão. O
 * histórico que importa já existe onde importa — o `payload` da
 * `proposed_action` de paralelismo congela o `maxParallel` vigente no momento
 * do pedido, então "o teto era outro quando aquele agente subiu" continua
 * respondível ([RN-083](../../../../docs/business-rules.md)).
 */
@Injectable()
export class SetAreaMaxParallelUseCase {
  constructor(private readonly areas: AgentAreaRepository) {}

  async execute(projectId: string, key: string, maxParallel: number) {
    // Validado AQUI, e não só no domínio de paralelismo: `max_parallel < 1`
    // faria TODO pedido ser recusado, e o usuário descobriria isso pelo agente
    // que não sobe — longe da tela onde ele errou o número.
    if (!Number.isInteger(maxParallel) || maxParallel < 1) {
      throw new BadRequestException(
        `max_parallel precisa ser inteiro >= 1 (recebido: ${maxParallel})`,
      );
    }

    return this.areas.setMaxParallel(projectId, key, maxParallel);
  }
}
