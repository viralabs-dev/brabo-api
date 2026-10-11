import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ListOpenQuestionsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'answered', 'all'], default: 'open' })
  @IsOptional()
  @IsIn(['open', 'answered', 'all'])
  status?: 'open' | 'answered' | 'all';
}

export class AnswerOpenQuestionDto {
  @ApiPropertyOptional({
    example: '404 for a code that does not exist.',
    description: 'Free-text answer. Send this OR `aceitarSugestao: true`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resposta?: string;

  @ApiPropertyOptional({
    example: true,
    description: "Accept the agent's suggestion as the answer.",
  })
  @IsOptional()
  @IsBoolean()
  aceitarSugestao?: boolean;
}

export class OpenQuestionAffectsDto {
  @ApiProperty({ type: [String] }) regras!: string[];
  @ApiProperty({ type: [String] }) historias!: string[];
  @ApiProperty({ type: [String] }) tarefas!: string[];
}

export class OpenQuestionAnswerDto {
  @ApiProperty() texto!: string;
  @ApiProperty() aceitouSugestao!: boolean;
  @ApiProperty() decisionEventId!: string;
  @ApiProperty() respondidaPor!: string;
  @ApiProperty({ format: 'date-time' }) respondidaEm!: string;
}

export class OpenQuestionResponseDto {
  @ApiProperty({ format: 'uuid' }) questionId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() pergunta!: string;
  @ApiProperty({ type: String, nullable: true }) sugestao!: string | null;
  @ApiProperty({ type: OpenQuestionAffectsDto })
  afeta!: OpenQuestionAffectsDto;
  @ApiProperty({ example: 'criativo', description: 'The agent that asked.' })
  autor!: string;
  @ApiProperty({ format: 'date-time' }) criadaEm!: string;
  @ApiProperty({ enum: ['open', 'answered'] }) status!: 'open' | 'answered';
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The user who created the origin session — the only one who may answer.',
  })
  autorDaSessao!: string | null;
  @ApiProperty({ type: OpenQuestionAnswerDto, nullable: true })
  resposta!: OpenQuestionAnswerDto | null;
}

export class OpenQuestionsListResponseDto {
  @ApiProperty({ type: [OpenQuestionResponseDto] })
  itens!: OpenQuestionResponseDto[];
  @ApiProperty({
    description: 'Total matching the filter; `itens` is capped at 50 (RN-180).',
  })
  total!: number;
}
