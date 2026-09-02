import { requireStoreContext } from "@/lib/auth/store-context";
import { getMediaLibrarySnapshot } from "@/lib/media/library";

import { MediaLibraryClient } from "./media-library-client";

export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const context = await requireStoreContext();
  const snapshot = await getMediaLibrarySnapshot({
    storeId: context.storeId,
    userId: context.userId,
    role: context.role,
    features: context.features,
  });

  return (
    <MediaLibraryClient
      initialSnapshot={snapshot}
      storeId={context.storeId}
    />
  );
}
