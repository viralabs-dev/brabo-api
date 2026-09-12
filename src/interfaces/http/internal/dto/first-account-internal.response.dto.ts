import { ApiProperty } from '@nestjs/swagger';

/**
 * O que a primeira conta devolve ao instalador (RN-546, ADR 0155).
 *
 * Três identificadores e nada mais. Não há token de sessão aqui de propósito:
 * o instalador não faz login por ninguém — ele termina dizendo à pessoa que a
 * conta existe, e ela entra pela tela. E não há eco da senha em campo nenhum.
 */
export class FirstAccountInternalResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '01JC4Z0000USUARIO0000000001',
    description: 'The user that was created.',
  })
  userId!: string;

  @ApiProperty({
    example: 'voce@exemplo.dev',
    description:
      'The NORMALIZED e-mail — what was actually written, which can differ ' +
      'from what was typed. This is what the installer records in its marker.',
  })
  email!: string;

  @ApiProperty({
    format: 'uuid',
    example: '01JC4Z0000WORKSPACE00000001',
    description:
      'The personal workspace born in the SAME transaction (RN-410), with ' +
      'the account as its `owner`. Without it the install would close with a ' +
      'login that works and a dashboard where "New project" has nowhere to ' +
      'create.',
  })
  workspaceId!: string;
}
