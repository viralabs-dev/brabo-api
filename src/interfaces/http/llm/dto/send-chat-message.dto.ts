import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendChatMessageDto {
  @ApiProperty({
    example: 'Resuma o que já decidimos sobre o checkout.',
    description: 'A mensagem do usuário. A resposta volta como stream SSE.',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
