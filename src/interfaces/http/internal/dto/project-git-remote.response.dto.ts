import { ApiProperty } from '@nestjs/swagger';

/**
 * O remoto de trabalho de um projeto, para o engine buscar e empurrar
 * ([ADR 0056](../../../../../../docs/adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
 *
 * Esta resposta **carrega um segredo** quando `kind` é `remote`. Ela existe
 * porque o engine não tem a chave mestra e não deve tê-la; em troca, quem a
 * consome tem uma obrigação: injetar o token por invocação e nunca escrevê-lo
 * em arquivo — nem no `.git/config`, que fica dentro da pasta onde a
 * [RN-075](../../../../../../docs/business-rules.md#rn-075) deu leitura
 * auto-aprovada ao dev agent.
 */
export class ProjectGitRemoteResponseDto {
  @ApiProperty({
    example: 'remote',
    enum: ['local', 'remote'],
    description:
      '`local` é caminho de bare repo no disco e não tem credencial; ' +
      '`remote` é URL que exige autenticação.',
  })
  kind!: 'local' | 'remote';

  @ApiProperty({
    example: 'https://github.com/daneiel/hello-api.git',
    description:
      'O que vira `git remote add origin <isto>`. **Sem credencial embutida**, ' +
      'de propósito: é este valor que fica gravado no `.git/config` do ' +
      'workspace, legível por quem tiver acesso ao diretório do projeto.',
  })
  origin!: string;

  @ApiProperty({ example: 'main' })
  defaultBranch!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Só em `remote`. Token do OWNER do workspace (RN-058), decifrado no ' +
      'momento da chamada. Quem recebe injeta por invocação e descarta.',
  })
  token?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'x-access-token',
    description: 'Usuário do par HTTP Basic; o token é a senha.',
  })
  username?: string;
}
