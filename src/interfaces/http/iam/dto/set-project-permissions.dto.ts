import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetProjectPermissionsDto {
  @ApiProperty({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description: 'Padrões aprovados automaticamente.',
  })
  @IsArray()
  @IsString({ each: true })
  allow!: string[];

  @ApiProperty({
    example: ['Terminal(rm -rf *)', 'Terminal(git push --force*)'],
    description:
      'Padrões proibidos. `deny` vence `allow` e vence a autonomia do agente.',
  })
  @IsArray()
  @IsString({ each: true })
  deny!: string[];

  @ApiProperty({
    example: ['Terminal(pnpm add *)'],
    description: 'Padrões que sempre pedem decisão humana.',
  })
  @IsArray()
  @IsString({ each: true })
  ask!: string[];
}
