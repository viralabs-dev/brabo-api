import { Inject, Injectable } from '@nestjs/common';
import { MergeAutomaticoEventoRepository } from '../../../application/ports/merge-automatico-evento-repository.port';
import { mergeAutomaticoEventos } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleMergeAutomaticoEventoRepository implements MergeAutomaticoEventoRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async registrar(input: {
    projectId: string;
    userId: string;
    habilitado: boolean;
  }): Promise<void> {
    await currentDb(this.rootDb).insert(mergeAutomaticoEventos).values(input);
  }
}
