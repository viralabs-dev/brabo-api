import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { ChatAttachmentRepository } from '../../ports/chat-attachment-repository.port';
import {
  AnexoGrandeDemaisError,
  AnexoTipoNaoAceitoError,
  MAX_ANEXOS_POR_MENSAGEM,
  classificarAnexo,
  type ReferenciaDeAnexo,
} from '../../../domain/sessions/anexos';
import {
  ConversaEmSessaoEncerradaError,
  garantirQueSessaoAceitaEvento,
} from '../../../domain/sessions/conversa-em-sessao-encerrada';
import { conflitoDeSessaoEncerrada } from './append-session-event.use-case';

/** Anexos do chat (AT-715, ADR 0246, RN-986..988). */
@Injectable()
export class AnexosDoChatUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly anexos: ChatAttachmentRepository,
  ) {}

  private async sessao(projectId: string, sessionId: string) {
    const s = await this.sessions.findInProject(projectId, sessionId);
    if (!s) throw new NotFoundException('Sessão não encontrada');
    return s;
  }

  async enviar(
    projectId: string,
    sessionId: string,
    userId: string,
    nome: string,
    base64: string,
  ): Promise<ReferenciaDeAnexo> {
    const s = await this.sessao(projectId, sessionId);
    try {
      // Anexar é conversa: sessão terminal recusa com o 409 da RN-581.
      garantirQueSessaoAceitaEvento(s.status, 'chat.message', {
        kind: 'user',
        id: userId,
      });
    } catch (e) {
      if (e instanceof ConversaEmSessaoEncerradaError)
        throw conflitoDeSessaoEncerrada(e);
      throw e;
    }
    const bytes = Buffer.from(base64, 'base64');
    let mime: string;
    try {
      mime = classificarAnexo(bytes);
    } catch (e) {
      if (e instanceof AnexoGrandeDemaisError)
        throw new PayloadTooLargeException(e.message);
      if (e instanceof AnexoTipoNaoAceitoError)
        throw new UnsupportedMediaTypeException(e.message);
      throw e;
    }
    const { id } = await this.anexos.create({
      projectId,
      sessionId,
      autorId: userId,
      nome,
      mime,
      tamanho: bytes.length,
      bytes,
    });
    return { id, nome, mime, tamanho: bytes.length };
  }

  /** 404 para sessão ou projeto alheio (RN-988). */
  async ler(projectId: string, sessionId: string, id: string) {
    await this.sessao(projectId, sessionId);
    const a = await this.anexos.find(projectId, sessionId, id);
    if (!a) throw new NotFoundException('Anexo não encontrado');
    return a;
  }

  /**
   * Resolve ids em referências para o `chat.message` (RN-987): no máximo 4,
   * todos da mesma sessão e do mesmo autor, senão 400.
   */
  async referencias(
    projectId: string,
    sessionId: string,
    userId: string,
    ids: string[],
  ): Promise<ReferenciaDeAnexo[]> {
    if (ids.length === 0) return [];
    if (ids.length > MAX_ANEXOS_POR_MENSAGEM)
      throw new BadRequestException(
        `No máximo ${MAX_ANEXOS_POR_MENSAGEM} anexos por mensagem.`,
      );
    const metas = await this.anexos.findManyMeta(projectId, sessionId, ids);
    const porId = new Map(metas.map((m) => [m.id, m]));
    return ids.map((id) => {
      const m = porId.get(id);
      if (!m || m.autorId !== userId)
        throw new BadRequestException(
          `Anexo ${id} não é desta sessão ou não é seu.`,
        );
      return { id, nome: m.nome, mime: m.mime, tamanho: m.tamanho };
    });
  }
}
