import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ROLE_ORDER, type Role } from '../../../domain/iam/role';

export class AcessoRapidoDto {
  @ApiProperty({ enum: ROLE_ORDER })
  @IsIn(ROLE_ORDER)
  papel!: Role;
}

export class PapelDoAcessoRapidoDto {
  @ApiProperty({ enum: ROLE_ORDER })
  papel!: Role;

  @ApiProperty({ example: 'owner@brabo.dev' })
  email!: string;
}

export class PapeisDoAcessoRapidoResponseDto {
  @ApiProperty({ type: [PapelDoAcessoRapidoDto] })
  papeis!: PapelDoAcessoRapidoDto[];
}
