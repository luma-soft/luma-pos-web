import { requireStoreContext } from "@/lib/auth/store-context";
import { getMediaLibrarySnapshot } from "@/lib/media/library";
import { parseMediaLibraryQuery } from "@/lib/media/library-query";

import { MediaLibraryClient } from "./media-library-client";

export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const context = await requireStoreContext();
  const snapshot = await getMediaLibrarySnapshot({
    storeId: context.storeId,
    userId: context.userId,
    role: context.role,
    features: context.features,
  }, parseMediaLibraryQuery(new URLSearchParams({ includeSources: "1" })));

  return (
    <MediaLibraryClient
      initialSnapshot={snapshot}
      storeId={context.storeId}
    />
  );
}
