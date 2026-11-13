import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProjectDto } from '../../../../src/interfaces/http/iam/dto/update-project.dto';
import { SetAutoMergeDto } from '../../../../src/interfaces/http/iam/dto/set-auto-merge.dto';

describe('merge_automatico fora do PATCH (RN-1316)', () => {
  it('o ValidationPipe global (whitelist) descarta a chave do UpdateProjectDto', async () => {
    const dto = plainToInstance(UpdateProjectDto, {
      mergeAutomatico: true,
    });
    await validate(dto, { whitelist: true });
    expect((dto as Record<string, unknown>).mergeAutomatico).toBeUndefined();
  });

  it('SetAutoMergeDto exige um booleano explícito', async () => {
    const ok = await validate(
      plainToInstance(SetAutoMergeDto, { habilitado: true }),
    );
    const vazio = await validate(plainToInstance(SetAutoMergeDto, {}));
    const texto = await validate(
      plainToInstance(SetAutoMergeDto, { habilitado: 'true' }),
    );
    expect(ok).toEqual([]);
    expect(vazio).not.toEqual([]);
    expect(texto).not.toEqual([]);
  });
});
