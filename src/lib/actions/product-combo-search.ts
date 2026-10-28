"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/actions/common";
import { requireStockAccess } from "@/lib/actions/common";
import {
  getComboProductCandidatePage,
  type ComboProductCandidatePage,
} from "@/lib/data/products";

const comboProductSearchInput = z.object({
  query: z.string().trim().max(100),
  offset: z.number().int().min(0).max(50_000),
  selectedIds: z.array(z.string().uuid()).max(100),
  includeCandidates: z.boolean(),
});

export async function loadComboProductCandidates(
  input: z.input<typeof comboProductSearchInput>,
): Promise<ActionResult<ComboProductCandidatePage>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;

  const parsed = comboProductSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  return {
    ok: true,
    data: await getComboProductCandidatePage(
      gate.storeId,
      parsed.data.query,
      parsed.data.offset,
      parsed.data.selectedIds,
      parsed.data.includeCandidates,
    ),
  };
}
