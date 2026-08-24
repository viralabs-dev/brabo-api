import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetProjectPermissionsDto {
  @ApiProperty({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description: 'Automatically approved patterns.',
  })
  @IsArray()
  @IsString({ each: true })
  allow!: string[];

  @ApiProperty({
    example: ['Terminal(rm -rf *)', 'Terminal(git push --force*)'],
    description:
      "Forbidden patterns. `deny` beats `allow` and beats the agent's autonomy.",
  })
  @IsArray()
  @IsString({ each: true })
  deny!: string[];

  @ApiProperty({
    example: ['Terminal(pnpm add *)'],
    description: 'Patterns that always ask for a human decision.',
  })
  @IsArray()
  @IsString({ each: true })
  ask!: string[];
}
