import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmProjectWorkspaceInternalDto {
  @ApiProperty({
    example: '/home/voce/projetos/loja',
    description:
      'Caminho absoluto confirmado pelo runner NO HOST — a fonte da ' +
      'verdade (RN-423). Revalidado LEXICAMENTE aqui antes de gravar; ' +
      'inválido é 400, nunca gravado.',
  })
  @IsString()
  path!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000SESSAO00000000001',
    description:
      'A sessão mais recente do projeto (`ProjectSession.latest_id/1`), ' +
      'resolvida do lado engine. `null`/omitido quando o projeto ainda não ' +
      'tem sessão nenhuma — o projeto é atualizado mesmo assim, só o ' +
      'evento de auditoria é pulado (lacuna aceita, RN-423).',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000USUARIO0000000001',
    description:
      'Quem pediu o ticket do runner (dono do socket que confirmou) — vira ' +
      'o ator do evento `project.workspace_verified`. Omitido: o evento (se ' +
      'houver sessão) nasce sem ator identificado.',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}
