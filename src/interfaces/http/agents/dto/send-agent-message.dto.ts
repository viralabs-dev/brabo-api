import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendAgentMessageDto {
  @ApiProperty({
    example: 'I want to allow discount coupons at checkout.',
    minLength: 1,
    maxLength: 10000,
    description: "User's message to the session's active agent.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 4,
    description:
      'Ids of chat attachments (`POST .../attachments`): at most 4, all from this session and uploaded by the sender (RN-987). The `chat.message` records only the reference, never the bytes.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('all', { each: true })
  anexos?: string[];
}
