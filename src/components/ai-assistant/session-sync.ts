/** An initial autosave can create the session before React publishes its ID. */
export async function waitForAutosavedSessionId(
  currentId: string | null,
  pendingSave: Promise<unknown> | null,
): Promise<string | null> {
  const saved = await pendingSave;
  if (currentId) return currentId;
  if (!saved || typeof saved !== "object") return null;
  const session = (saved as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  const id = (session as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}
