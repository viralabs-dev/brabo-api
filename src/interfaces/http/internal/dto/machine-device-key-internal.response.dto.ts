import { ApiProperty } from '@nestjs/swagger';

/**
 * O que o registro da chave de máquina devolve ao instalador (RN-552).
 *
 * O campo que importa é o `id`, e ele importa por um motivo caro: é ele que
 * vai gravado DENTRO da JWK privada, no `kid` (RN-475). Esse é o único vínculo
 * entre o arquivo em disco e a pública do servidor, e a cadeia inteira só o
 * REPASSA — o agente local lê `jwk.kid`, o JWT de ticket o leva no header, o
 * `PatAuthGuard` acha a pública por ele. Ninguém o deriva de outra coisa, e foi
 * exatamente por ele faltar que o modo automático do navegador nunca
 * autenticou.
 *
 * A JWK pública não volta (quem a mandou acabou de gerá-la) e a privada a api
 * nunca viu.
 */
export class MachineDeviceKeyInternalResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '01JC4Z0000CHAVE000000000001',
    description:
      'The registration id. Write it into the PRIVATE JWK as `kid` before ' +
      'saving the file (RN-475): it is the only link between the key on disk ' +
      'and the public half on the server, and every step downstream only ' +
      'passes it along.',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '01JC4Z0000USUARIO0000000001',
    description:
      "The owner the api RESOLVED — the installation's sole user. The caller " +
      'does not choose it and does not send it; this field is here so the ' +
      'installer can check it against the account it just created rather ' +
      'than assume.',
  })
  userId!: string;

  @ApiProperty({ example: 'servidor-de-casa' })
  name!: string;

  @ApiProperty({ example: '2026-09-12T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Ids of the MACHINE keys this one REPLACED — revoked in the same ' +
      'transaction. Empty is the normal case (a fresh installation). ' +
      'Non-empty means a local agent still holding one of them stops ' +
      'getting tickets, and the installer should say so instead of letting ' +
      'it be discovered. Project keys (ADR 0118) are never touched.',
  })
  replacedKeyIds!: string[];
}
