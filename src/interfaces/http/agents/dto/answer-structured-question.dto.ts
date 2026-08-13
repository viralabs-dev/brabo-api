import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * Resposta ao formulário de `chat.structured_question` (RN-162). `answers`
 * é indexado pelo MESMO `id` que veio em cada pergunta — o use case valida
 * que toda pergunta tem resposta não-vazia; chave sem pergunta correspondente
 * é ignorada, em vez de recusada, para não travar num rename de campo que o
 * cliente não sincronizou.
 */
export class AnswerStructuredQuestionDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      nome: 'Checkout Fácil',
      usuarios: 'Lojistas de pequeno porte',
      plataforma: 'Web',
    },
    description:
      'Resposta por `id` de pergunta — o mesmo `id` que veio em `chat.structured_question`.',
  })
  @IsObject()
  answers!: Record<string, string>;
}
