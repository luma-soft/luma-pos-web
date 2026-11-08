/** Change URL-owned overlay state without re-requesting the parent Server Component tree.
 * Only use for detail overlays whose content is already present on the client.
 * Real list filtering, mutations and page changes must still use Next.js navigation.
 */
export function updateModalUrlQuery(
  changes: Record<string, string | null>,
  mode: "push" | "replace" = "replace",
) {
  const url = new URL(window.location.href);
  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    const previous = url.searchParams.get(key);
    if (value === null) {
      if (previous !== null) {
        url.searchParams.delete(key);
        changed = true;
      }
    } else if (previous !== value) {
      url.searchParams.set(key, value);
      changed = true;
    }
  }
  if (!changed) return;
  const method = mode === "push" ? "pushState" : "replaceState";
  window.history[method](null, "", `${url.pathname}${url.search}${url.hash}`);
}
