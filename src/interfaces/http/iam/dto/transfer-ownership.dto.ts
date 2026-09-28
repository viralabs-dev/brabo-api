import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Corpo de `PUT workspaces/:workspaceId/owner-of-record` (ADR 0173, RN-616). */
export class TransferOwnershipDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f1b2c8e-5a4d-4b7e-9c10-2d6f8a1b4c33',
    description:
      'Id of the user who becomes the owner of record. Must already be an ' +
      '`owner` of this workspace.',
  })
  @IsUUID()
  userId!: string;
}
