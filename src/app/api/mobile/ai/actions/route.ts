import { createDraftPurchaseForUser } from "@/lib/purchases/draft";
import { createPurchase } from "@/lib/actions/purchases";
import { writeAuditLog } from "@/lib/audit";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inboundPayload(preview: Record<string, unknown>) {
  const action = objectValue(preview.action);
  const payload = objectValue(action?.payload);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const firstItem = objectValue(items[0]);
  const productId = typeof firstItem?.productId === "string" ? firstItem.productId : null;
  const quantity = numberValue(firstItem?.quantity);
  const supplierId = typeof payload?.supplierId === "string" ? payload.supplierId : null;
  const warehouseId = typeof payload?.warehouseId === "string" ? payload.warehouseId : null;

  if (!productId || quantity <= 0 || !supplierId || !warehouseId) {
    return null;
  }

  return {
    supplierId,
    warehouseId,
    discount: numberValue(payload?.discount),
    vatRate: numberValue(payload?.vatRate),
    amountPaid: numberValue(payload?.amountPaid),
    invoiceNumber: typeof payload?.invoiceNumber === "string" ? payload.invoiceNumber : undefined,
    note: typeof payload?.note === "string" ? payload.note : "AI inventory inbound",
    items: [
      {
        productId,
        quantity,
        unitCost: numberValue(firstItem?.unitCost),
        discount: numberValue(firstItem?.discount),
      },
    ],
  };
}

async function createRestockingDraftPurchase(userId: string, preview: Record<string, unknown>) {
  const action = objectValue(preview.action);
  const payload = objectValue(action?.payload);
  const itemIds = new Set(stringArray(payload?.itemIds));
  const restockRows = await getRestockSuggestions(30);
  const rows = restockRows
    .filter((row) => itemIds.size === 0 || itemIds.has(row.id))
    .slice(0, 25)
    .filter((row) => row.suggestedQty > 0);

  if (rows.length === 0) {
    return { ok: false as const, error: "errors.invalidData" };
  }

  return createDraftPurchaseForUser(userId, {
    note: "Draft from AI Assistant restocking command",
    items: rows.map((row) => ({
      productId: row.id,
      quantity: row.suggestedQty,
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileAction({ ok: false, error: "errors.unauthorized" });

  const body = objectValue(await readJson(request));
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  const event = String(body.event ?? "");
  if (!["confirmed", "cancelled"].includes(event)) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const preview = objectValue(body.actionPreview);
  const intent = String(preview?.intent ?? "ai_action");
  const entityType = String(preview?.entityType ?? "ai_action");
  const entityId = typeof preview?.entityId === "string" ? preview.entityId : null;
  const prompt = typeof body.prompt === "string" ? body.prompt : null;

  if (event === "confirmed" && intent === "create_draft_purchase_order_from_restocking") {
    if (!["owner", "manager", "warehouse"].includes(gate.role)) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "unauthorized",
        prompt,
        parsedIntent: preview,
        metadata: { surface: body.surface ?? "assistant" },
      });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }

    const result = await createRestockingDraftPurchase(gate.userId, preview ?? {});
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: intent,
      entityType: "purchase_order",
      entityId: result.ok ? result.data.id : entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      parsedIntent: preview,
      after: result.ok
        ? {
            id: result.data.id,
            code: result.data.code,
            href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
          }
        : null,
      affectedRecords: result.ok
        ? [
            {
              type: "purchase_order",
              id: result.data.id,
              code: result.data.code,
            },
          ]
        : null,
      metadata: {
        surface: body.surface ?? "assistant",
        event,
        executedTool: "createDraftPurchaseForUser",
      },
    });

    if (!result.ok) {
      return mobileAction(result);
    }

    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã tạo PO nháp ${result.data.code} từ gợi ý nhập hàng AI.`,
        record: {
          type: "purchase_order",
          id: result.data.id,
          code: result.data.code,
          href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
        },
      },
    });
  }

  if (event === "confirmed" && intent === "create_inventory_inbound") {
    if (!["owner", "manager", "warehouse"].includes(gate.role)) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "unauthorized",
        prompt,
        parsedIntent: preview,
        metadata: { surface: body.surface ?? "assistant" },
      });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }

    const payload = preview ? inboundPayload(preview) : null;
    if (!payload) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "failed",
        prompt,
        parsedIntent: preview,
        metadata: {
          surface: body.surface ?? "assistant",
          reason: "missing_required_inbound_fields",
        },
      });
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }

    const result = await createPurchase(payload);
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: intent,
      entityType: "purchase_order",
      entityId: result.ok ? result.data.id : entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      parsedIntent: preview,
      after: result.ok
        ? {
            id: result.data.id,
            code: result.data.code,
            href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
          }
        : null,
      affectedRecords: result.ok
        ? [
            {
              type: "purchase_order",
              id: result.data.id,
              code: result.data.code,
            },
          ]
        : null,
      metadata: {
        surface: body.surface ?? "assistant",
        event,
        executedTool: "createPurchase",
      },
    });

    if (!result.ok) {
      return mobileAction(result);
    }

    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã tạo phiếu nhập ${result.data.code} và cập nhật tồn kho.`,
        record: {
          type: "purchase_order",
          id: result.data.id,
          code: result.data.code,
          href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
        },
      },
    });
  }

  await writeAuditLog({
    actorUserId: gate.userId,
    source: "ai",
    action: intent,
    entityType,
    entityId,
    status: event as "confirmed" | "cancelled",
    prompt,
    parsedIntent: preview,
    metadata: {
      surface: body.surface ?? "assistant",
      note:
        event === "confirmed"
          ? "Framework confirmation logged; business mutation is implemented by later task-specific tools."
          : "User cancelled AI preview before execution.",
    },
  });

  return mobileAction({
    ok: true,
    data: {
      status: event,
      message:
        event === "confirmed"
          ? "Đã ghi nhận xác nhận. Action thực thi thật sẽ được nối ở task nghiệp vụ tiếp theo."
          : "Đã hủy preview, không có dữ liệu nào bị thay đổi.",
    },
  });
}
