import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../../application/ports/project-repository.port';
import type { Project } from '../../../domain/iam/project.entity';
import type {
  ProjectMember,
  ProjectMemberWithUser,
} from '../../../domain/iam/project-member.entity';
import type { Role } from '../../../domain/iam/role';
import { projectMembers, projects, users } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleProjectRepository implements ProjectRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(
    input: ProjectInput & {
      id: string;
      workspaceId: string;
      createdBy: string;
      workspaceDirName: string;
    },
  ): Promise<Project> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(projects).values(input).returning();
    return row;
  }

  async findById(id: string): Promise<Project | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    return row ?? null;
  }

  async listForWorkspace(workspaceId: string): Promise<Project[]> {
    const db = currentDb(this.rootDb);
    return db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
  }

  async update(
    id: string,
    input: Partial<ProjectInput>,
  ): Promise<Project | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return row ?? null;
  }

  async remove(id: string): Promise<Project | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();
    return row ?? null;
  }

  async addMember(
    projectId: string,
    userId: string,
    role: Role,
  ): Promise<ProjectMember> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(projectMembers)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      })
      .returning();
    return row;
  }

  async findMemberRole(
    projectId: string,
    userId: string,
  ): Promise<Role | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      );
    return row?.role ?? null;
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      );
  }

  async listMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
    const db = currentDb(this.rootDb);
    return db
      .select({
        userId: projectMembers.userId,
        role: projectMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId));
  }
}
