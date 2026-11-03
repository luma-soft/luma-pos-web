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
  taxDefaultRate?: number;
  updatedAt?: string;
}

export interface PosDraftSnapshotOptions {
  taxDefaultRate?: number;
}

function scopedKey(key: string, scopeId: string) {
  return `${key}:${scopeId}`;
}

function comparableDraft(value: object): string {
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.syncUpdatedAt;
  const serialize = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(",")}]`;
    if (entry != null && typeof entry === "object") {
      const object = entry as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(entry) ?? "null";
  };
  return serialize(copy);
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
        taxDefaultRate: typeof parsed.taxDefaultRate === "number" && Number.isFinite(parsed.taxDefaultRate)
          ? parsed.taxDefaultRate
          : undefined,
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
  options: PosDraftSnapshotOptions = {},
): boolean {
  try {
    const previousSnapshot = loadPosDraftSnapshot(storage, scopeId);
    const previousById = new Map(previousSnapshot?.drafts.flatMap((draft) =>
      typeof draft.id === "string" ? [[draft.id, draft] as const] : [],
    ) ?? []);
    const now = Date.now();
    const previousSnapshotTime = Date.parse(previousSnapshot?.updatedAt ?? "") || 0;
    const timestamp = new Date(Math.max(now, previousSnapshotTime + 1)).toISOString();
    const timestampedDrafts = drafts.map((draft) => {
      const value = draft as TDraft & { id?: string; syncUpdatedAt?: string };
      const previous = value.id ? previousById.get(value.id) as (TDraft & { syncUpdatedAt?: string }) | undefined : undefined;
      const unchanged = previous != null && comparableDraft(previous) === comparableDraft(value);
      const previousDraftTime = Date.parse(previous?.syncUpdatedAt ?? previousSnapshot?.updatedAt ?? "") || 0;
      const currentDraftTime = Date.parse(value.syncUpdatedAt ?? "") || 0;
      const unchangedTimestamp = previousDraftTime >= currentDraftTime
        ? previous?.syncUpdatedAt
        : value.syncUpdatedAt;
      return {
        ...draft,
        syncUpdatedAt: unchanged
          ? unchangedTimestamp ?? timestamp
          : new Date(Math.max(now, previousDraftTime + 1)).toISOString(),
      };
    });
    storage.setItem(
      scopedKey(POS_DRAFT_STATE_KEY, scopeId),
      JSON.stringify({
        version: 2,
        activeId,
        drafts: timestampedDrafts,
        ...(typeof options.taxDefaultRate === "number"
          ? { taxDefaultRate: options.taxDefaultRate }
          : {}),
        updatedAt: timestamp,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Persist a held cart and its fresh replacement in one storage write. */
export function parkPosDraftSnapshot<TDraft extends object>(
  storage: PosDraftStorage,
  scopeId: string,
  drafts: readonly TDraft[],
  activeId: string,
  nextDraft: TDraft & { id: string },
  options: PosDraftSnapshotOptions = {},
): PosDraftSnapshot<TDraft & { heldAt?: string }> | null {
  const heldAt = new Date().toISOString();
  const parked = drafts.map((draft) =>
    (draft as TDraft & { id?: string }).id === activeId
      ? { ...draft, heldAt }
      : draft,
  );
  if (!parked.some((draft) => (draft as TDraft & { id?: string }).id === activeId)) {
    return null;
  }
  const next = [...parked, nextDraft];
  if (!savePosDraftSnapshot(storage, scopeId, next, nextDraft.id, options)) return null;
  return {
    version: 2,
    activeId: nextDraft.id,
    drafts: next,
    ...options,
  };
}

type TaxDraft = {
  taxRate: number;
  source?: unknown;
};

/**
 * Reconcile unsaved drafts when the store's automatic VAT default changes.
 * Source documents and rates that differ from a known previous default are
 * explicit user/document choices and remain untouched.
 */
export function reconcilePosDraftTaxDefaults<TDraft extends TaxDraft>(
  drafts: readonly TDraft[],
  input: {
    currentDefaultRate: number;
    previousDefaultRate?: number;
  },
): TDraft[] {
  return drafts.map((draft) => {
    if (draft.source != null) return draft;
    const usesKnownPreviousDefault = input.previousDefaultRate != null
      && draft.taxRate === input.previousDefaultRate;
    const isLegacyDraftWhileAutoVatIsOff = input.previousDefaultRate == null
      && input.currentDefaultRate === 0;
    if (!usesKnownPreviousDefault && !isLegacyDraftWhileAutoVatIsOff) return draft;
    return { ...draft, taxRate: input.currentDefaultRate };
  });
}
