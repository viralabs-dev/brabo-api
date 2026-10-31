import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  MODEL_BILLINGS,
  type ModelBilling,
} from '../../../../domain/llm/model.entity';

export class UpdateModelBillingDto {
  @ApiProperty({ enum: MODEL_BILLINGS, example: 'subscription' })
  @IsIn(MODEL_BILLINGS)
  billing!: ModelBilling;
}
