import { IsNotEmpty, IsString } from 'class-validator';

export class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
