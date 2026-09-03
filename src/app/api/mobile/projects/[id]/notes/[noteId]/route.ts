import {
  deleteProjectNote,
  getProjectForNotes,
  updateProjectNote,
} from "@/lib/data/project-notes";
import { requireMobileManager } from "@/lib/mobile/auth";
import {
  canManageProjectNotes,
  projectNoteContentSchema,
} from "@/lib/mobile/project-note-access";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

type RouteContext = {
  params: Promise<{ id: string; noteId: string }>;
};

async function requireProject(
  storeId: string,
  projectId: string,
) {
  return getProjectForNotes(storeId, projectId);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  const { id, noteId } = await params;
  const project = await requireProject(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  if (!canManageProjectNotes(gate, project.serviceType)) {
    return mobileError("errors.forbidden", 403);
  }
  const parsed = projectNoteContentSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  try {
    const updated = await updateProjectNote({
      storeId: gate.storeId,
      actorId: gate.userId,
      projectId: id,
      noteId,
      content: parsed.data.content,
    });
    return updated
      ? mobileOk(updated)
      : mobileError("errors.notFound", 404);
  } catch (error) {
    console.error("update project note failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  const { id, noteId } = await params;
  const project = await requireProject(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  if (!canManageProjectNotes(gate, project.serviceType)) {
    return mobileError("errors.forbidden", 403);
  }
  try {
    const deleted = await deleteProjectNote({
      storeId: gate.storeId,
      actorId: gate.userId,
      projectId: id,
      noteId,
    });
    return deleted
      ? mobileOk({ id: deleted.id })
      : mobileError("errors.notFound", 404);
  } catch (error) {
    console.error("delete project note failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
