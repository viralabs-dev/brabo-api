import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
}
