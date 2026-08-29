import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterRunnerDeviceKeyRequestDto {
  @ApiProperty({
    example: 'laptop',
    description:
      'Nome pra você reconhecer este dispositivo depois — não é único.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    example: '{"kty":"OKP","crv":"Ed25519","x":"…"}',
    description:
      'JWK pública Ed25519 (RFC 8037), serializada como JSON — a privada nunca sai do navegador.',
  })
  @IsString()
  @MinLength(1)
  publicKeyJwk!: string;
}
