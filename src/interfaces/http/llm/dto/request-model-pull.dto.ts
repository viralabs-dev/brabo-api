import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * `repoId` vai no CORPO, não na rota, de propósito: o formato real do Hub é
 * `<publisher>/<modelo>` (ex. `meta-llama/Llama-3.1-8B-Instruct-GGUF`), e um
 * `/` dentro de um `:repoId` de path quebra o casamento de rota — a mesma
 * razão pela qual `code.controller.ts` (FASE 26b) passa caminho de arquivo
 * por query, nunca por segmento de path.
 */
export class RequestModelPullDto {
  @ApiProperty({
    example: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
    description: '`<publisher>/<model>` on the Hugging Face Hub.',
  })
  @IsString()
  @MinLength(3)
  repoId!: string;

  @ApiProperty({
    required: false,
    example: 4900000000,
    description:
      'Comes from the search when the Hub published the size — never ' +
      'guessed by the client.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  estimatedSizeBytes?: number;
}
