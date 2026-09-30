import type {
  Handoff,
  HandoffStatus,
} from '../../domain/sessions/handoff.entity';

export interface NewHandoff {
  sessionId: string;
  projectId: string;
  fromAgent: string;
  toAgent: string;
  artifactId?: string | null;
  status?: HandoffStatus;
}

export abstract class HandoffRepository {
  abstract create(input: NewHandoff): Promise<Handoff>;
  abstract findById(id: string): Promise<Handoff | null>;
  abstract findBySession(sessionId: string): Promise<Handoff[]>;
  /**
   * Todos os handoffs do PROJETO, de todas as sessões, em ordem de criação.
   * Só leitura. Existe para a recusa da ativação sem repositório (RN-582)
   * dizer QUAL handoff falta aceitar: o handoff ao Arquiteto mora na sessão
   * do PO, e a ativação não sabe de que sessão partiu.
   */
  abstract findByProject(projectId: string): Promise<Handoff[]>;
  abstract updateStatus(id: string, status: HandoffStatus): Promise<Handoff>;
  /**
   * As ofertas `offered` ao destino no PROJETO, em ordem de criação (ADR 0182,
   * RN-635). Normalmente zero ou uma; mais de uma só em dado anterior ao ADR.
   */
  abstract findOfferedToAgentInProject(
    projectId: string,
    toAgent: string,
  ): Promise<Handoff[]>;
  /**
   * Serializa, até o fim da transação CORRENTE, quem mexe nas ofertas de
   * (projeto, destino) — lock consultivo de transação, nunca de linha: a
   * pergunta "já há oferta?" é sobre uma linha que talvez não exista ainda.
   * Sem transação ativa o lock soltaria na hora e não serializaria nada, então
   * quem chama DEVE estar dentro de `UnitOfWork.runInTransaction`.
   */
  abstract travarOfertasDoDestino(
    projectId: string,
    toAgent: string,
  ): Promise<void>;
}
