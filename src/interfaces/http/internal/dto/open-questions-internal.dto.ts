import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AgentAnswerOpenQuestionDto {
  @ApiProperty({ description: 'The chat session where the user answered.' })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({ example: 'criativo', description: 'The agent closing it.' })
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @ApiPropertyOptional({
    description: 'Answer text; omitted = the suggestion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resposta?: string;

  @ApiPropertyOptional({ description: 'The chat message event that answered.' })
  @IsOptional()
  @IsString()
  messageEventId?: string;
}

export class AgentAnswerOpenQuestionResponseDto {
  @ApiProperty({ enum: ['answered', 'already_answered'] })
  @IsIn(['answered', 'already_answered'])
  status!: 'answered' | 'already_answered';

  @ApiProperty({ format: 'uuid' }) questionId!: string;
}
