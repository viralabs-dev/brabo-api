import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DeteccaoDeIdiomaRepository } from '../../ports/deteccao-de-idioma-repository.port';
import {
  AT080,
  PARAMETROS_PROVISORIOS,
  evidenciasDoAutor,
  idiomaConcordante,
  mensagensNecessarias,
  type Idioma,
} from '../../../domain/iam/heuristica-de-idioma';
import { idiomaAPerguntar } from '../../../domain/iam/deteccao-de-idioma';
import {
  normalizarIdiomaBcp47,
  type IdiomaDaRespostaResolvido,
} from '../../../domain/iam/idioma-de-resposta';
import { ResolverIdiomaDaRespostaUseCase } from './resolver-idioma-da-resposta.use-case';
import {
  preferenciasDoUsuario,
  type PreferenciasDoUsuario,
} from './get-user-preferences.use-case';

export type RespostaAPergunta = 'confirm' | 'decline';

/**
 * A detecção do idioma do AUTOR pelas próprias mensagens (AT-163, RN-624).
 *
 * ## Onde roda
 *
 * Na LEITURA do idioma da sessão (`GET .../response-language`, a barra da
 * AT-165), e não dentro de `SendAgentMessageUseCase`. A evidência é o event
 * log — o `chat.message` que o envio acabou de gravar já está nele, com o
 * ator —, então detectar na leitura custa o mesmo e dá três coisas que o
 * envio não dá: a pergunta sobrevive a recarregar a página e aparece em
 * qualquer sessão (o detectado é GLOBAL, AT-168 resposta 6); o envio não ganha
 * latência nenhuma; e uma falha da detecção não tem como tocar a mensagem —
 * ela nem está no caminho dela.
 *
 * ## Sem estado de detecção
 *
 * A amostra é lida do event log a cada vez (índice parcial por ator), e a
 * histerese é REFEITA (`idiomaConcordante`), nunca guardada. O único estado
 * novo é o que a pessoa DECIDE: a recusa (`detected_language_declines`) e o
 * confirmado (`users.detected_language`, que já existia desde a RN-618).
 * Nada guarda país, nacionalidade ou proficiência (AT-080).
 *
 * ## Os parâmetros são PROVISÓRIOS
 *
 * `PARAMETROS_PROVISORIOS` saiu do corpus sintético da AT-160; o dono os
 * recalibra com o corpus real. Ver o docblock deles.
 */
@Injectable()
export class DetectarIdiomaDoAutorUseCase {
  private readonly logger = new Logger(DetectarIdiomaDoAutorUseCase.name);

  constructor(
    private readonly repositorio: DeteccaoDeIdiomaRepository,
    private readonly resolver: ResolverIdiomaDaRespostaUseCase,
  ) {}

  /** O idioma que as mensagens da pessoa apontam hoje, ou `null`. */
  async detectar(userId: string): Promise<Idioma | null> {
    const p = PARAMETROS_PROVISORIOS;
    const necessarias = mensagensNecessarias(p);
    // O dobro: cada resposta de formulário tem um eco (`chat.message`
    // concatenado) que `evidenciasDoAutor` descarta, e o eco não pode
    // encolher a amostra.
    const eventos = await this.repositorio.ultimasEvidencias(
      userId,
      necessarias * 2,
    );
    const textos = evidenciasDoAutor(eventos, (e) => e.sessionId)
      .map((ev) => ev.texto)
      .slice(-necessarias);
    return idiomaConcordante(textos, AT080, p);
  }

  /**
   * O idioma a PERGUNTAR a esta pessoa, dado o efetivo dela agora — ou
   * `null`. Melhor esforço: qualquer falha (banco, heurística) vira log e
   * `null`, porque a pergunta é um convite e a tela do idioma não pode cair
   * por causa dela.
   */
  async pergunta(
    userId: string,
    efetivo: IdiomaDaRespostaResolvido,
  ): Promise<Idioma | null> {
    try {
      // Sem ler o event log quando a origem já exclui a pergunta.
      if (efetivo.origem === 'sessao' || efetivo.origem === 'conta') {
        return null;
      }
      const [detectado, recusados] = await Promise.all([
        this.detectar(userId),
        this.repositorio.recusados(userId),
      ]);
      return idiomaAPerguntar({ detectado, efetivo, recusados });
    } catch (erro) {
      // Origem `infra` (RN-059): a detecção é melhor esforço, e a falha dela
      // é dita no log com a origem — nunca vira erro da rota de leitura.
      this.logger.warn(
        `[origem=infra] detecção de idioma falhou para ${userId}: sem pergunta desta vez (${erro instanceof Error ? erro.message : String(erro)})`,
      );
      return null;
    }
  }

  /**
   * A resposta da pessoa à pergunta. `confirm` grava o detectado CONFIRMADO
   * (e ele passa a valer onde a Conta está em automático); `decline` grava a
   * recusa, e ESTE idioma não é perguntado de novo.
   *
   * Confirmar exige que a detecção aponte AGORA o mesmo idioma: a coluna diz
   * "detectado", e gravar nela algo que a heurística não detectou a faria
   * mentir. Se a amostra mudou entre a pergunta e o clique, 409 — a tela
   * relê e pergunta o que vale. Recusar não exige: recusar um idioma que já
   * não é detectado não grava nada falso.
   */
  async responder(
    userId: string,
    idioma: string,
    resposta: RespostaAPergunta,
  ): Promise<PreferenciasDoUsuario> {
    const canonico = normalizarIdiomaBcp47(idioma);
    if (canonico === null) {
      throw new BadRequestException(
        `"${idioma}" não é um código de idioma BCP-47 reconhecido.`,
      );
    }
    if (resposta === 'decline') {
      await this.repositorio.recusar(userId, canonico);
    } else {
      const detectado = await this.detectar(userId);
      if (detectado !== canonico) {
        throw new ConflictException({
          code: 'deteccao_mudou',
          message:
            `As suas mensagens não apontam mais "${canonico}" ` +
            `(hoje: ${detectado ?? 'nenhum idioma com confiança'}); nada foi gravado.`,
        });
      }
      await this.repositorio.confirmar(userId, canonico, new Date());
    }
    return preferenciasDoUsuario(this.resolver, userId);
  }
}
