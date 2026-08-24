import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendChatMessageDto {
  @ApiProperty({
    example: 'Summarize what we have already decided about checkout.',
    description:
      "The user's message. The response comes back as an SSE stream.",
  })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
