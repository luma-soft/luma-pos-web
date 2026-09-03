import { recordActivity } from "@/lib/audit/activity-log";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, projectNotes, projects } from "@/db/schema";

const projectNoteSelection = {
  id: projectNotes.id,
  projectId: projectNotes.projectId,
  content: projectNotes.content,
  authorId: projectNotes.createdBy,
  authorName: profiles.fullName,
  createdAt: projectNotes.createdAt,
  updatedAt: projectNotes.updatedAt,
};

export async function getProjectForNotes(storeId: string, projectId: string) {
  const [project] = await db.select({
    id: projects.id,
    serviceType: projects.serviceType,
  }).from(projects).where(and(
    eq(projects.storeId, storeId),
    eq(projects.id, projectId),
  )).limit(1);
  return project ?? null;
}

export async function listProjectNotes(storeId: string, projectId: string) {
  return db.select(projectNoteSelection)
    .from(projectNotes)
    .leftJoin(profiles, and(
      eq(projectNotes.createdBy, profiles.id),
      eq(projectNotes.storeId, profiles.storeId),
    ))
    .where(and(
      eq(projectNotes.storeId, storeId),
      eq(projectNotes.projectId, projectId),
    ))
    .orderBy(desc(projectNotes.updatedAt), desc(projectNotes.createdAt));
}

export async function createProjectNote(input: {
  storeId: string;
  projectId: string;
  actorId: string;
  content: string;
}) {
  return db.transaction(async (tx) => {
    const [note] = await tx.insert(projectNotes).values({
      storeId: input.storeId,
      projectId: input.projectId,
      content: input.content,
      createdBy: input.actorId,
    }).returning({
      id: projectNotes.id,
      projectId: projectNotes.projectId,
      content: projectNotes.content,
      authorId: projectNotes.createdBy,
      createdAt: projectNotes.createdAt,
      updatedAt: projectNotes.updatedAt,
    });
    await tx.update(projects).set({ note: input.content }).where(and(
      eq(projects.storeId, input.storeId),
      eq(projects.id, input.projectId),
    ));
    await recordActivity(tx, { storeId: input.storeId, actorId: input.actorId,
      action: "project.note.created", entityType: "project", entityId: input.projectId,
      after: { note: input.content } });
    return note;
  });
}

export async function updateProjectNote(input: {
  storeId: string;
  projectId: string;
  noteId: string;
  actorId: string;
  content: string;
}) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ content: projectNotes.content }).from(projectNotes)
      .where(and(eq(projectNotes.storeId, input.storeId), eq(projectNotes.projectId, input.projectId), eq(projectNotes.id, input.noteId)))
      .limit(1).for("update");
    if (!before) return null;
    const [updated] = await tx.update(projectNotes).set({
      content: input.content,
      updatedAt: new Date(),
    }).where(and(
      eq(projectNotes.storeId, input.storeId),
      eq(projectNotes.projectId, input.projectId),
      eq(projectNotes.id, input.noteId),
    )).returning({ id: projectNotes.id });
    if (!updated) return null;

    const [latest] = await tx.select({ content: projectNotes.content })
      .from(projectNotes)
      .where(and(
        eq(projectNotes.storeId, input.storeId),
        eq(projectNotes.projectId, input.projectId),
      ))
      .orderBy(desc(projectNotes.updatedAt), desc(projectNotes.createdAt))
      .limit(1);
    await tx.update(projects).set({ note: latest?.content ?? null }).where(and(
      eq(projects.storeId, input.storeId),
      eq(projects.id, input.projectId),
    ));
    if (before.content !== input.content) await recordActivity(tx, { storeId: input.storeId, actorId: input.actorId,
      action: "project.note.updated", entityType: "project", entityId: input.projectId,
      before: { note: before.content }, after: { note: input.content } });
    return updated;
  });
}

export async function deleteProjectNote(input: {
  storeId: string;
  projectId: string;
  noteId: string;
  actorId: string;
}) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ content: projectNotes.content }).from(projectNotes)
      .where(and(eq(projectNotes.storeId, input.storeId), eq(projectNotes.projectId, input.projectId), eq(projectNotes.id, input.noteId)))
      .limit(1).for("update");
    if (!before) return null;
    const [deleted] = await tx.delete(projectNotes).where(and(
      eq(projectNotes.storeId, input.storeId),
      eq(projectNotes.projectId, input.projectId),
      eq(projectNotes.id, input.noteId),
    )).returning({ id: projectNotes.id });
    if (!deleted) return null;

    const [latest] = await tx.select({ content: projectNotes.content })
      .from(projectNotes)
      .where(and(
        eq(projectNotes.storeId, input.storeId),
        eq(projectNotes.projectId, input.projectId),
      ))
      .orderBy(desc(projectNotes.updatedAt), desc(projectNotes.createdAt))
      .limit(1);
    await tx.update(projects).set({ note: latest?.content ?? null }).where(and(
      eq(projects.storeId, input.storeId),
      eq(projects.id, input.projectId),
    ));
    await recordActivity(tx, { storeId: input.storeId, actorId: input.actorId,
      action: "project.note.deleted", entityType: "project", entityId: input.projectId,
      before: { note: before.content }, metadata: { noteId: input.noteId } });
    return deleted;
  });
}
