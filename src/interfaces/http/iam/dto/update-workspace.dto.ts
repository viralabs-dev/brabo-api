// `PartialType` do @nestjs/swagger, e não do @nestjs/mapped-types: o do
// mapped-types copia só a validação e o DTO sairia SEM PROPRIEDADE NENHUMA no
// documento OpenAPI. O do swagger faz as duas coisas.
import { PartialType } from '@nestjs/swagger';
import { CreateWorkspaceDto } from './create-workspace.dto';

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {}
