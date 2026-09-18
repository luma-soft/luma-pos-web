export const SWITCHABLE_POS_DRAFT_KINDS = [
  "invoice",
  "quote",
  "booking",
] as const;

export type SwitchablePosDraftKind = (typeof SWITCHABLE_POS_DRAFT_KINDS)[number];

export type PosDraftKindSwitchGuard = {
  kind: string;
  hasSource: boolean;
  isCameraQuote: boolean;
  isHeld: boolean;
};

export function isSwitchablePosDraftKind(
  kind: string,
): kind is SwitchablePosDraftKind {
  return (SWITCHABLE_POS_DRAFT_KINDS as readonly string[]).includes(kind);
}

export function canSwitchPosDraftKind(
  guard: PosDraftKindSwitchGuard,
): boolean {
  return isSwitchablePosDraftKind(guard.kind)
    && !guard.hasSource
    && !guard.isCameraQuote
    && !guard.isHeld;
}

export function switchPosDraftKind<
  TDraft extends {
    kind: string;
    payMethod: "cash" | "bank_transfer" | "credit";
    paidInput: number | null;
  },
>(draft: TDraft, kind: SwitchablePosDraftKind): TDraft {
  return {
    ...draft,
    kind,
    payMethod: "cash",
    paidInput: null,
  };
}
