import { ApiProperty } from '@nestjs/swagger';
import { ProposedActionResponseDto } from './actions.response.dto';

class ItemDeProjetoDto {
  @ApiProperty() projectId!: string;
  @ApiProperty() projectName!: string;
}

class ItemDeAcaoDto extends ItemDeProjetoDto {
  @ApiProperty({ type: ProposedActionResponseDto })
  acao!: ProposedActionResponseDto;
}

class ItemDePromocaoDto extends ItemDeProjetoDto {
  @ApiProperty() storyId!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty({
    description:
      'Data da última alteração da história (a promoção não grava data própria).',
  })
  desde!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Só no modo `decided`: quando o usuário recusou (devolveu ao PO).',
  })
  decididaEm!: string | null;
}

class ItemDeArquiteturaDto extends ItemDeProjetoDto {
  @ApiProperty() storyId!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty({ enum: ['no_module', 'missing_module'] })
  motivo!: 'no_module' | 'missing_module';
  @ApiProperty({ type: [String] }) faltando!: string[];
  @ApiProperty({
    description:
      'Emprestada da história (`updatedAt`): a pendência é derivada e não tem data.',
  })
  desde!: string;
  @ApiProperty({ example: true }) dataEmprestada!: true;
}

class ItemDeHipoteseDto extends ItemDeProjetoDto {
  @ApiProperty() hipoteseId!: string;
  @ApiProperty() hipotese!: string;
  @ApiProperty() agenteAlvo!: string;
  @ApiProperty({
    example: 'proposed',
    description: '`proposed`, ou o desfecho no modo `decided`.',
  })
  situacao!: string;
  @ApiProperty() desde!: string;
  @ApiProperty({ type: String, nullable: true }) decididaEm!: string | null;
}

const TOTAL = 'Total REAL da fila, mesmo quando `itens` é truncada (RN-1197).';
const TRUNCADA = '`true` quando `total` passa do teto de itens.';

class FilaDeAcoesDto {
  @ApiProperty({ description: TOTAL }) total!: number;
  @ApiProperty({ description: TRUNCADA }) truncada!: boolean;
  @ApiProperty({ type: [ItemDeAcaoDto] }) itens!: ItemDeAcaoDto[];
}
class FilaDePrsDto extends FilaDeAcoesDto {}
class FilaDePromocoesDto {
  @ApiProperty({ description: TOTAL }) total!: number;
  @ApiProperty({ description: TRUNCADA }) truncada!: boolean;
  @ApiProperty({ type: [ItemDePromocaoDto] }) itens!: ItemDePromocaoDto[];
}
class FilaDeArquiteturaDto {
  @ApiProperty({ description: TOTAL }) total!: number;
  @ApiProperty({ description: TRUNCADA }) truncada!: boolean;
  @ApiProperty({ type: [ItemDeArquiteturaDto] }) itens!: ItemDeArquiteturaDto[];
}
class FilaDeHipotesesDto {
  @ApiProperty({ description: TOTAL }) total!: number;
  @ApiProperty({ description: TRUNCADA }) truncada!: boolean;
  @ApiProperty({ type: [ItemDeHipoteseDto] }) itens!: ItemDeHipoteseDto[];
}

class FilasDto {
  @ApiProperty({
    type: FilaDeAcoesDto,
    description: 'Ações pendentes EXCETO `git_merge`.',
  })
  aprovacoes!: FilaDeAcoesDto;
  @ApiProperty({ type: FilaDePrsDto, description: 'Só `git_merge`.' })
  prs!: FilaDePrsDto;
  @ApiProperty({ type: FilaDePromocoesDto }) promocoes!: FilaDePromocoesDto;
  @ApiProperty({
    type: FilaDeArquiteturaDto,
    description:
      'Derivada: vazia no modo `decided` (não há decisão humana a listar).',
  })
  arquitetura!: FilaDeArquiteturaDto;
  @ApiProperty({ type: FilaDeHipotesesDto }) hipoteses!: FilaDeHipotesesDto;
}

class ProjetoDaCaixaDto {
  @ApiProperty() projectId!: string;
  @ApiProperty() nome!: string;
  @ApiProperty() aprovacoes!: number;
  @ApiProperty() prs!: number;
  @ApiProperty() promocoes!: number;
  @ApiProperty() arquitetura!: number;
  @ApiProperty() hipoteses!: number;
  @ApiProperty({
    type: [String],
    description:
      'Agentes com ação pendente (aprovações + PRs); não afetado pelo teto de itens.',
  })
  agentesAguardando!: string[];
}

/** Cinco filas separadas e NENHUM `total` na raiz: as filas nunca se somam (RN-467). */
export class DecisionInboxResponseDto {
  @ApiProperty() geradoEm!: string;
  @ApiProperty({ enum: ['pending', 'decided'] }) status!: 'pending' | 'decided';
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Início da janela, só no modo `decided`.',
  })
  desde!: string | null;
  @ApiProperty({ example: 50 }) tetoPorFila!: number;
  @ApiProperty({ type: FilasDto }) filas!: FilasDto;
  @ApiProperty({ type: [ProjetoDaCaixaDto] }) projetos!: ProjetoDaCaixaDto[];
}
