import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  WorkspaceRepository,
  type WorkspaceInput,
  type WorkspaceWithRole,
} from '../../../application/ports/workspace-repository.port';
import type { Workspace } from '../../../domain/iam/workspace.entity';
import type { WorkspaceMember } from '../../../domain/iam/workspace-member.entity';
import type { Role } from '../../../domain/iam/role';
import { workspaceMembers, workspaces } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(
    input: WorkspaceInput & { createdBy: string },
  ): Promise<Workspace> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(workspaces).values(input).returning();
    return row;
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<WorkspaceMember> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role },
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<Workspace | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id));
    return row ?? null;
  }

  async listForUser(userId: string): Promise<WorkspaceWithRole[]> {
    const db = currentDb(this.rootDb);
    return db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));
  }

  async update(
    id: string,
    input: Partial<WorkspaceInput>,
  ): Promise<Workspace | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(workspaces)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  }

  async remove(id: string): Promise<Workspace | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .delete(workspaces)
      .where(eq(workspaces.id, id))
      .returning();
    return row ?? null;
  }

  async findMemberRole(
    workspaceId: string,
    userId: string,
  ): Promise<Role | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    return row?.role ?? null;
  }
}
