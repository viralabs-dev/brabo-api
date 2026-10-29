import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional } from 'class-validator';

class PortaDto {
  @ApiProperty({ example: 8080 }) host!: number;
  @ApiProperty({ example: 3000 }) container!: number;
  @ApiProperty({ example: 'tcp' }) protocol!: 'tcp';
}
class HostExtraDto {
  @ApiProperty({ example: 'api.local' }) name!: string;
  @ApiProperty({ example: '10.0.0.5' }) ip!: string;
}

/** Corpo de `PUT .../container/network` (AT-608, RN-931). A régua fina é do domínio (400 `rede_invalida` nomeando o campo). */
export class DeclararRedeDto {
  @ApiProperty({
    type: [PortaDto],
    required: false,
    description:
      'Up to 10 TCP ports published on 127.0.0.1 only. `host` 1024-65535, ' +
      'never an installation port, no duplicates.',
  })
  @IsOptional()
  @IsArray()
  ports?: PortaDto[];

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Up to 3 literal IPs.',
  })
  @IsOptional()
  @IsArray()
  dns?: string[];

  @ApiProperty({
    type: [HostExtraDto],
    required: false,
    description:
      'Up to 10 `--add-host` entries: name in [a-z0-9.-], never localhost or an installation service, IPv4 literal.',
  })
  @IsOptional()
  @IsArray()
  extraHosts?: HostExtraDto[];
}

export class RedeDoContainerResponseDto {
  @ApiProperty({ type: [PortaDto] }) ports!: PortaDto[];
  @ApiProperty({ type: [String] }) dns!: string[];
  @ApiProperty({ type: [HostExtraDto] }) extraHosts!: HostExtraDto[];
  @ApiProperty({ example: 1 }) version!: number;
}
