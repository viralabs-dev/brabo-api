// Ver a nota em update-workspace.dto.ts sobre a origem do `PartialType`.
import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
