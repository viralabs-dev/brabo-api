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
      'Identificador do repositório NO PROVIDER: `owner/repo` no github, ' +
      '`namespace/path` no gitlab, caminho absoluto do bare repo no local. ' +
      'Nada é criado — o repositório precisa já existir e a credencial ' +
      'cadastrada precisa alcançá-lo.',
  })
  @IsString()
  @IsNotEmpty()
  externalId!: string;
}
