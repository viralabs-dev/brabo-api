import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UploadAnexoDto {
  @ApiProperty({ example: 'erro.png', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nome!: string;

  @ApiProperty({
    description:
      'File bytes in base64. The type is read from the BYTES (png, jpeg, webp, gif or UTF-8 text), never from the name. ' +
      'Limits: 5 MB per image, 512 KB per text file (RN-986).',
  })
  @IsString()
  @MinLength(1)
  // 5 MB em base64 ~ 6,7 M caracteres; o corpo JSON já fecha em 10 MB.
  @MaxLength(7_000_000)
  base64!: string;
}

export class AnexoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'erro.png' })
  nome!: string;

  @ApiProperty({ example: 'image/png' })
  mime!: string;

  @ApiProperty({ example: 1024, description: 'Size in bytes.' })
  tamanho!: number;
}
