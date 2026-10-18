export function shouldRefreshDeferredAppPath({
  routeChanged,
  pendingPath,
  currentPath,
  modalOpen,
}: {
  routeChanged: boolean;
  pendingPath: string | null;
  currentPath: string;
  modalOpen: boolean;
}) {
  return routeChanged && pendingPath === currentPath && !modalOpen;
}
