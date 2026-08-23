import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetModelBindingDto {
  @ApiProperty({
    format: 'uuid',
    example: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
    description: 'Model to pin to this scope. Must exist in `GET /models`.',
  })
  @IsUUID()
  modelId!: string;
}
