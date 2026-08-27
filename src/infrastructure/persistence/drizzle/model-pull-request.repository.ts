import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ModelPullRequestRepository,
  type NewModelPullRequest,
} from '../../../application/ports/model-pull-request-repository.port';
import type { ModelPullRequest } from '../../../domain/huggingface/model-pull-request.entity';
import { huggingFaceModelPullRequests } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleModelPullRequestRepository implements ModelPullRequestRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewModelPullRequest): Promise<ModelPullRequest> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(huggingFaceModelPullRequests)
      .values({
        workspaceId: input.workspaceId,
        requestedBy: input.requestedBy,
        repoId: input.repoId,
        estimatedSizeBytes: input.estimatedSizeBytes ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<ModelPullRequest | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(huggingFaceModelPullRequests)
      .where(eq(huggingFaceModelPullRequests.id, id));
    return row ?? null;
  }

  async findByIdInWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<ModelPullRequest | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(huggingFaceModelPullRequests)
      .where(
        and(
          eq(huggingFaceModelPullRequests.id, id),
          eq(huggingFaceModelPullRequests.workspaceId, workspaceId),
        ),
      );
    return row ?? null;
  }

  async markConfirmed(id: string): Promise<ModelPullRequest> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(huggingFaceModelPullRequests)
      .set({
        status: 'confirmed',
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(huggingFaceModelPullRequests.id, id))
      .returning();
    return row;
  }

  async markPulling(id: string): Promise<ModelPullRequest> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(huggingFaceModelPullRequests)
      .set({ status: 'pulling', updatedAt: new Date() })
      .where(eq(huggingFaceModelPullRequests.id, id))
      .returning();
    return row;
  }

  async markActive(id: string): Promise<ModelPullRequest> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(huggingFaceModelPullRequests)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(huggingFaceModelPullRequests.id, id))
      .returning();
    return row;
  }

  async markFailed(id: string, reason: string): Promise<ModelPullRequest> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(huggingFaceModelPullRequests)
      .set({ status: 'failed', failedReason: reason, updatedAt: new Date() })
      .where(eq(huggingFaceModelPullRequests.id, id))
      .returning();
    return row;
  }
}
