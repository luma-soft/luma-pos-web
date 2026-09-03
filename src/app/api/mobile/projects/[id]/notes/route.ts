import {
  createProjectNote,
  getProjectForNotes,
  listProjectNotes,
} from "@/lib/data/project-notes";
import {
  requireMobileManager,
  requireMobileUser,
} from "@/lib/mobile/auth";
import {
  canManageProjectNotes,
  canReadProjectNotes,
  projectNoteContentSchema,
} from "@/lib/mobile/project-note-access";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const project = await getProjectForNotes(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  if (!canReadProjectNotes(gate, project.serviceType)) {
    return mobileError("errors.forbidden", 403);
  }
  try {
    return mobileOk(await listProjectNotes(gate.storeId, id));
  } catch (error) {
    console.error("list project notes failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const project = await getProjectForNotes(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  if (!canManageProjectNotes(gate, project.serviceType)) {
    return mobileError("errors.forbidden", 403);
  }
  const parsed = projectNoteContentSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  try {
    return mobileOk(await createProjectNote({
      storeId: gate.storeId,
      projectId: id,
      actorId: gate.userId,
      content: parsed.data.content,
    }));
  } catch (error) {
    console.error("create project note failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
