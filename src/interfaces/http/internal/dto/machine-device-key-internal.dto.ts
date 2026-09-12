import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * O que o instalador manda para registrar a chave de máquina (RN-552,
 * ADR 0155 ponto 4).
 *
 * **Não há `userId` aqui, e a ausência é a contenção.** O dono é o usuário
 * único da instalação, resolvido pelo caso de uso — com um campo para ele,
 * quem tivesse o `BRABO_SERVICE_TOKEN` escolheria para QUEM fabricar uma
 * credencial duradoura. Mesma disciplina da rota de primeira conta, cuja
 * condição também é sobre a instalação e nunca sobre o argumento pedido.
 *
 * E não há campo para a metade privada, em forma nenhuma: ela é gerada na
 * máquina e fica lá. Uma JWK com `d` chega ao domínio e é recusada por nome
 * (`exigirJwkPublicaEd25519`), nunca gravada.
 */
export class MachineDeviceKeyInternalDto {
  @ApiProperty({
    example: 'servidor-de-casa',
    description:
      'A name for a human to recognize this MACHINE later, in the device ' +
      'key list of every project it serves. Not unique. The installer ' +
      'suggests the hostname; nothing here is derived from it by the api.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    example: '{"kty":"OKP","crv":"Ed25519","x":"…"}',
    description:
      'The PUBLIC Ed25519 JWK (RFC 8037), serialized as JSON. The pair is ' +
      'generated on the machine and the private half never travels — a JWK ' +
      'carrying `d` is refused with 400 saying so, never stored.',
  })
  @IsString()
  @MinLength(1)
  publicKeyJwk!: string;
}
