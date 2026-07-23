import { IsArray, IsString } from 'class-validator';

export class SetProjectPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  allow!: string[];

  @IsArray()
  @IsString({ each: true })
  deny!: string[];

  @IsArray()
  @IsString({ each: true })
  ask!: string[];
}
