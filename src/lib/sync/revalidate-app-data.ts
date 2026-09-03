import { revalidatePath as nextRevalidatePath } from "next/cache";

/**
 * Call only after a mutation commits successfully. Related records appear in
 * multiple list/detail routes and parallel modal slots, so invalidating one
 * page is insufficient. The authenticated layout includes all these surfaces
 * without remounting client drafts or touching public/auth pages.
 *
 * revalidatePath also works in Route Handlers used by mobile/API clients;
 * unlike next/cache refresh(), this helper is not Server-Action-only.
 */
export function revalidateAppData(path: string, type?: "page" | "layout") {
  nextRevalidatePath(path, type);
  if (path !== "/(app)" || type !== "layout") {
    nextRevalidatePath("/(app)", "layout");
  }
}
