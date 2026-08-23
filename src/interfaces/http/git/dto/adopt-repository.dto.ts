import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Adoção de repositório existente (Fase 12a).
 *
 * Rota própria em vez de um `mode: create | adopt` no
 * `ProvisionRepositoryDto`: `@RequireRole` e OpenAPI são por rota,
 * `route-surface.spec.ts` classifica por rota, um DTO discriminado
 * produziria esquema fraco no gerado — e as respostas são diferentes
 * (criar devolve o cursor do bootstrap; adotar devolve o PLANO).
 */
export class AdoptRepositoryDto {
  @ApiProperty({
    example: 'acme/checkout',
    description:
      "The repository's identifier ON THE PROVIDER: `owner/repo` on github, " +
      "`namespace/path` on gitlab, the bare repo's absolute path locally. " +
      'Nothing is created — the repository must already exist and the ' +
      'registered credential must be able to reach it.',
  })
  @IsString()
  @IsNotEmpty()
  externalId!: string;
}
