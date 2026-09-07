import { ApiProperty } from '@nestjs/swagger';

/**
 * O ACK de um reporte de rodada do espelho (RN-517).
 *
 * Deliberadamente MAGRO: o engine não decide nada com esta resposta (ele só
 * loga), e quem lê o estado completo é a tela, por
 * `GET /projects/:projectId/mirror-state`. `status` vem junto porque é o que
 * permite provar, numa asserção só, que a rodada gravada é a que passou a
 * valer.
 */
export class MirrorSyncResultResponseDto {
  @ApiProperty({ example: true })
  recorded!: boolean;

  @ApiProperty({
    example: 'synced',
    enum: ['never', 'synced', 'failed'],
    description:
      'Which of the three states is CURRENT after this write. `never` is ' +
      'unreachable here (every write stamps one of the two timestamps) and ' +
      'is listed because the vocabulary is the same one the screen reads.',
  })
  status!: 'never' | 'synced' | 'failed';
}
