export const LEGACY_POS_DRAFTS_KEY = "pos-invoices";
export const LEGACY_POS_ACTIVE_DRAFT_KEY = "pos-active-invoice";
export const POS_DRAFT_STATE_KEY = "pos-draft-state-v2";

export interface PosDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PosDraftSnapshot<TDraft = Record<string, unknown>> {
  version: 1 | 2;
  activeId: string | null;
  drafts: TDraft[];
  updatedAt?: string;
}

function scopedKey(key: string, scopeId: string) {
  return `${key}:${scopeId}`;
}

function parseDrafts(raw: string | null): Record<string, unknown>[] | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((draft) => draft != null && typeof draft === "object" && !Array.isArray(draft))) {
    return null;
  }
  return parsed as Record<string, unknown>[];
}

export function loadPosDraftSnapshot(
  storage: PosDraftStorage,
  scopeId: string,
): PosDraftSnapshot | null {
  try {
    const currentRaw = storage.getItem(scopedKey(POS_DRAFT_STATE_KEY, scopeId));
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw) as Partial<PosDraftSnapshot>;
      if (parsed.version !== 2 || !Array.isArray(parsed.drafts) || parsed.drafts.length === 0) {
        return null;
      }
      if (!parsed.drafts.every((draft) => draft != null && typeof draft === "object" && !Array.isArray(draft))) {
        return null;
      }
      return {
        version: 2,
        activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
        drafts: parsed.drafts as Record<string, unknown>[],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      };
    }

    const drafts = parseDrafts(
      storage.getItem(scopedKey(LEGACY_POS_DRAFTS_KEY, scopeId)),
    );
    if (!drafts) return null;
    const legacyActiveId = storage.getItem(
      scopedKey(LEGACY_POS_ACTIVE_DRAFT_KEY, scopeId),
    );
    return {
      version: 1,
      activeId: legacyActiveId?.trim() || null,
      drafts,
    };
  } catch {
    return null;
  }
}

export function savePosDraftSnapshot<TDraft extends object>(
  storage: PosDraftStorage,
  scopeId: string,
  drafts: readonly TDraft[],
  activeId: string,
): boolean {
  try {
    storage.setItem(
      scopedKey(POS_DRAFT_STATE_KEY, scopeId),
      JSON.stringify({
        version: 2,
        activeId,
        drafts: [...drafts],
        updatedAt: new Date().toISOString(),
      } satisfies PosDraftSnapshot<TDraft>),
    );
    return true;
  } catch {
    return false;
  }
}
