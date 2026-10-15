import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserPreferencesDto } from '../../../../src/interfaces/http/iam/dto/user-preferences.dto';
import { USER_LOCALES } from '../../../../src/domain/iam/user.entity';

/** RN-891 (ADR 0216): o idioma da interface aceita os quatro, e só eles. */
describe('UpdateUserPreferencesDto.locale (RN-891)', () => {
  async function erros(locale: unknown) {
    return validate(plainToInstance(UpdateUserPreferencesDto, { locale }));
  }

  it('aceita pt-BR, en, ru e zh-Hans', async () => {
    expect(USER_LOCALES).toEqual(['pt-BR', 'en', 'ru', 'zh-Hans']);
    for (const locale of USER_LOCALES) {
      expect(await erros(locale)).toHaveLength(0);
    }
  });

  it('recusa idioma fora da lista (zh-Hant, de, zh-CN)', async () => {
    for (const locale of ['zh-Hant', 'de', 'zh-CN']) {
      expect((await erros(locale)).length).toBeGreaterThan(0);
    }
  });
});
