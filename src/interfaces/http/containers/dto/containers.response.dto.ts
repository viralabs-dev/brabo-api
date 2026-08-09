import { ApiProperty } from '@nestjs/swagger';
import type {
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../../domain/containers/project-container';

export class RecursosDoContainerResponseDto implements RecursosDoContainer {
  @ApiProperty({ example: 2, description: 'CPUs, fração permitida.' })
  cpus!: number;

  @ApiProperty({ example: 4096, description: 'Memória em MiB.' })
  memoryMb!: number;

  @ApiProperty({
    example: 512,
    description:
      'Teto de processos. É o que contém fork bomb sem depender de allowlist de verbo.',
  })
  pidsLimit!: number;
}

export class DecisaoDeImagemResponseDto {
  @ApiProperty({
    example: 'node:22-bookworm-slim',
    description:
      'Referência OCI com TAG explícita ou digest. `latest` é recusado: o ' +
      'artefato precisa dizer a mesma coisa daqui a seis meses.',
  })
  image!: string;

  @ApiProperty({
    example:
      'O module_map é todo TypeScript sobre Node; a slim basta e reduz superfície.',
    description: 'Por que ESTA imagem. É o que torna a decisão revisável.',
  })
  rationale!: string;

  @ApiProperty({
    enum: ['none', 'egress'],
    example: 'none',
    description:
      'Postura de rede do container, decidida UMA vez no artefato e não ' +
      'comando a comando. `egress` é gasto e superfície: o Arquiteto pede, o ' +
      'usuário autoriza no provisionamento.',
  })
  network!: PosturaDeRede;

  @ApiProperty({ type: RecursosDoContainerResponseDto })
  resources!: RecursosDoContainerResponseDto;
}

export class EstadoDoContainerResponseDto {
  @ApiProperty({
    enum: ['sem_decisao', 'decidido'],
    example: 'sem_decisao',
    description:
      '`sem_decisao` é o estado inicial de todo projeto e é ele que fecha o ' +
      'portão da RN-105: sem imagem não há container, e a aba Code não libera.',
  })
  status!: 'sem_decisao' | 'decidido';

  @ApiProperty({
    type: DecisaoDeImagemResponseDto,
    nullable: true,
    description: 'A decisão vigente, ou `null` quando ainda não há nenhuma.',
  })
  decisao!: DecisaoDeImagemResponseDto | null;

  @ApiProperty({
    example: 0,
    description:
      'Versão do artefato vigente; 0 quando não há decisão. Revisar é emitir ' +
      'uma versão nova — o histórico não é reescrito.',
  })
  version!: number;

  @ApiProperty({
    nullable: true,
    example: '01JC4Z0000EVENTO000000001',
    description: 'Id do evento que fixou a decisão vigente, para auditoria.',
  })
  eventId!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  decidedAt!: string | null;
}

export class ImagemDecididaResponseDto {
  @ApiProperty({ type: DecisaoDeImagemResponseDto })
  decisao!: DecisaoDeImagemResponseDto;

  @ApiProperty({ example: 1 })
  version!: number;
}
