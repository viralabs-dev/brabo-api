import { Controller, Get } from '@nestjs/common';
import { ListModelsUseCase } from '../../../application/use-cases/llm/list-models.use-case';

@Controller('models')
export class ModelsController {
  constructor(private readonly listModels: ListModelsUseCase) {}

  @Get()
  list() {
    return this.listModels.execute();
  }
}
