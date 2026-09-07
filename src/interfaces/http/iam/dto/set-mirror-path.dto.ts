import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, ValidateIf } from 'class-validator';

/**
 * Corpo de `PUT .../mirror-path` (RN-515, ADR 0147 ponto 4) — rota DEDICADA,
 * no molde de `ConvertExecutionModeDto`, e pelo mesmo motivo: `UpdateProjectDto`
 * exclui de propósito os campos que falam de uma pasta do computador do
 * operador.
 *
 * ## `null` é obrigatório e explícito, `undefined` é 400
 *
 * `@IsDefined()` exige a chave presente. Limpar o destino é `{"mirrorPath":
 * null}`, um ato deliberado — se a omissão também limpasse, todo cliente que
 * mandasse um corpo incompleto apagaria a configuração de alguém em silêncio,
 * e o usuário descobriria pelo espelho que parou de atualizar. `@IsOptional()`
 * não serve aqui: ele trata `null` e `undefined` como a mesma coisa, que é
 * exatamente a distinção que esta rota precisa fazer.
 */
export class SetMirrorPathDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '/home/you/mirrors/store',
    description:
      "The absolute path, ON THE USER'S MACHINE, where the local agent " +
      'copies the project work to (RN-515, ADR 0147). Send `null` — the key ' +
      'is REQUIRED, omitting it is a 400 — to clear the destination and turn ' +
      'the mirror off; `null` is the normal state of a project, not an ' +
      'error. Only `mounted`/`runner` projects can have one: in `container` ' +
      'the source is a server-side managed volume the local agent cannot ' +
      'see, and the request is refused with 400 naming that reason. The API ' +
      'validates ONLY the LEXICAL shape (absolute, no `..`/`.`, never the ' +
      "root, a system folder, or overlapping Brabo's own checkout) plus the " +
      'two directions of the origin↔destination loop (the destination cannot ' +
      'be inside `workspacePath`, nor contain it) — it never touches the ' +
      'disk, because it cannot see the machine where the destination will ' +
      'live, exactly as in `runner` mode (RN-423). Resolving symlinks is the ' +
      'local agent’s half of the guard, not this one.',
  })
  @IsDefined()
  @ValidateIf((o: SetMirrorPathDto) => o.mirrorPath !== null)
  @IsString()
  mirrorPath!: string | null;
}
