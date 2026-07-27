import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendAgentMessageDto {
  @ApiProperty({
    example: 'Quero permitir cupom de desconto no checkout.',
    minLength: 1,
    maxLength: 10000,
    description: 'Mensagem do usuário para o agente ativo da sessão.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text!: string;
}
