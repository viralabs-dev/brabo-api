import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { RunnerDeviceKeyRepository } from '../../ports/runner-device-key-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import {
  exigirJwkPublicaEd25519,
  JwkDeDispositivoInvalidaError,
} from '../../../domain/auth/jwk-de-dispositivo';

/** O que o instalador precisa gravar: o id vai DENTRO da JWK privada (RN-475). */
export interface ChaveDeMaquinaRegistrada {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  /** Ids das chaves de máquina que esta substituiu. Vazio é o caso normal. */
  substituidas: string[];
}

const MOTIVO_DA_SUBSTITUICAO =
  'substituída por uma chave de máquina registrada pelo instalador';

/**
 * A chave de dispositivo de MÁQUINA registrada pelo instalador (RN-552,
 * ADR 0155 ponto 4, ADR 0154 ponto 1).
 *
 * ## Por que ela existe
 *
 * O `install.sh` termina criando a primeira conta (RN-546) e subindo o agente
 * local já pareado. Parear exige uma credencial, e a única que existia era a
 * do navegador (ADR 0118) — presa a um PROJETO, numa instalação que ainda não
 * tem projeto nenhum. A sessão que fez a coluna `project_id` virar nullable
 * declarou esta lacuna por escrito e a deixou aberta de propósito: *"nenhuma
 * rota da api cria chave de máquina ainda; isso é o `install.sh`, e nasce com
 * o primeiro chamador"*. O chamador chegou.
 *
 * ## A credencial é o SERVICE TOKEN, e o que isso custa
 *
 * Quem abre a rota é o `BRABO_SERVICE_TOKEN`, o mesmo segredo que o
 * instalador gerou e escreveu no `.env` com modo 600 — a mesma credencial da
 * rota de primeira conta, no mesmo minuto do mesmo processo. A alternativa
 * considerada era exigir credencial do USUÁRIO recém-criado, e ela foi
 * recusada por contrariar o próprio ADR 0155, que já declara: *"não há token
 * de sessão aqui de propósito: o instalador não faz login por ninguém"*. A
 * senha lida no TTY é *"usada e descartada"*, e um login a transformaria numa
 * segunda credencial viva na máquina, gravada onde o instalador não promete
 * gravar nada.
 *
 * O custo está declarado, aqui e em `docs/security-surface.md`: um service
 * token vazado passa a poder FABRICAR uma credencial de acesso duradoura,
 * e não só falar com as rotas internas. É por isso que as três contenções
 * abaixo estão na ROTA, e não só no texto.
 *
 * ## Contenção 1 — a rota não sabe escolher de quem é a chave
 *
 * Não existe `userId` no corpo. O dono é o usuário ÚNICO da instalação,
 * resolvido aqui; havendo zero ou mais de um, a rota recusa com 409 e nada é
 * escrito. É o análogo exato da condição da RN-546: uma condição sobre a
 * INSTALAÇÃO, nunca sobre o argumento pedido. Com um `userId` no corpo, quem
 * tivesse o token escolheria a vítima — que é precisamente o que aquele 409
 * existe para impedir, de outra forma.
 *
 * Consequência declarada: numa instalação com duas pessoas esta rota não
 * funciona mais, para ninguém. Ela se cala como a da primeira conta se cala,
 * e pelo mesmo motivo — ela pertence ao MOMENTO da instalação, não à vida do
 * produto. Quem tem time e quer uma chave de máquina não tem por onde hoje, e
 * isso está declarado como lacuna, não escondido como acaso.
 *
 * ## Contenção 2 — registrar SUBSTITUI, nunca acumula
 *
 * Toda chave de máquina ATIVA do dono é revogada na MESMA transação. Uma
 * máquina reinstalada é caso legítimo e continua funcionando; mil chaves de
 * máquina não são, e passam a ser impossíveis — não por um número que
 * envelhece, mas porque o conjunto de chaves de máquina vivas de um usuário
 * nunca passa de uma. A resposta DIZ o que substituiu, em vez de deixar a
 * pessoa descobrir que algo caiu.
 *
 * Só as de MÁQUINA caem. As de projeto vieram do navegador, num fluxo que
 * esta rota não conhece, e derrubá-las apagaria o pareamento de quem já usa o
 * produto — o erro que a RN-545 nomeou ao recusar converter instalação alheia
 * em silêncio.
 *
 * ## Contenção 3 — a privada nunca viaja, e uma que chegue é RECUSADA
 *
 * O par é gerado na máquina e só a metade pública sobe. `exigirJwkPublicaEd25519`
 * é a MESMA régua do registro pelo navegador (uma, não duas) e recusa uma JWK
 * com `d` dizendo o que ela é: gravar uma privada por engano de quem serializou
 * o par inteiro é o pior desfecho possível desta rota.
 */
@Injectable()
export class RegistrarChaveDeMaquinaUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly usuarios: UserRepository,
    private readonly deviceKeys: RunnerDeviceKeyRepository,
    private readonly eventos: AuthEventRecorder,
  ) {}

  async execute(entrada: {
    name: string;
    publicKeyJwk: string;
  }): Promise<ChaveDeMaquinaRegistrada> {
    // ANTES da transação: uma JWK torta não merece abrir transação, e a
    // tradução é a mesma que o registro pelo navegador faz — sem ela, um
    // erro de domínio sairia 500 onde a resposta certa é "mande outra chave".
    try {
      exigirJwkPublicaEd25519(entrada.publicKeyJwk);
    } catch (erro) {
      if (erro instanceof JwkDeDispositivoInvalidaError) {
        throw new BadRequestException(erro.message);
      }
      throw erro;
    }

    return this.unitOfWork.runInTransaction(async () => {
      const dono = await this.usuarios.usuarioUnicoDaInstalacao();
      if (!dono) {
        throw new ConflictException(
          'Esta rota registra a chave de máquina do usuário ÚNICO de uma ' +
            'instalação — e esta instalação tem nenhum ou mais de um. Numa ' +
            'instalação com time, a chave de dispositivo vem da tela do ' +
            'projeto.',
        );
      }

      // A substituição vem ANTES do registro, na mesma transação: revogar
      // depois deixaria uma janela em que as duas estão vivas, e falhar no
      // meio deixaria a instalação com duas credenciais de máquina e nenhuma
      // forma de saber qual é a nova.
      const substituidas = await this.deviceKeys.revogarChavesDeMaquina(
        dono.id,
        MOTIVO_DA_SUBSTITUICAO,
      );

      const registrada = await this.deviceKeys.registrar({
        userId: dono.id,
        // `null` é o que FAZ dela uma chave de máquina (RN-543). Não há
        // projeto a escolher, e é esse o ponto: a instalação ainda não tem
        // nenhum.
        projectId: null,
        name: entrada.name,
        publicKeyJwk: entrada.publicKeyJwk,
      });

      await this.eventos.registrar({
        kind: 'machine_device_key_registered',
        subjectKey: assuntoDoUsuario(dono.id),
        userId: dono.id,
        // Nunca a JWK, nem o nome: o que uma auditoria precisa é de QUANDO,
        // de QUEM e do que caiu junto.
        metadata: { deviceKeyId: registrada.id, substituidas },
      });

      return {
        id: registrada.id,
        userId: dono.id,
        name: registrada.name,
        createdAt: registrada.createdAt,
        substituidas,
      };
    });
  }
}
