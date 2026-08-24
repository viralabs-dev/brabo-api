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
      '`local` is a bare-repo path on disk with no credential; `remote` is ' +
      'a URL that requires authentication.',
  })
  kind!: 'local' | 'remote';

  @ApiProperty({
    example: 'https://github.com/daneiel/hello-api.git',
    description:
      'What becomes `git remote add origin <this>`. **No credential ' +
      'embedded**, by design: this is the value that gets written into the ' +
      "workspace's `.git/config`, readable by anyone with access to the " +
      "project's directory.",
  })
  origin!: string;

  @ApiProperty({ example: 'main' })
  defaultBranch!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      "Only on `remote`. The workspace OWNER's token (RN-058), decrypted at " +
      'call time. Whoever receives it injects it per invocation and discards it.',
  })
  token?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'x-access-token',
    description: 'User of the HTTP Basic pair; the token is the password.',
  })
  username?: string;
}
