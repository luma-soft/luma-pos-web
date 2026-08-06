import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, suppliers, warehouses } from "@/db/schema";
import { requireStockAccess } from "@/lib/actions/common";
import { accentInsensitiveLike } from "@/lib/search";

const kinds = ["supplier", "warehouse", "category", "brand"] as const;
type FilterOptionKind = (typeof kinds)[number];

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") as FilterOptionKind | null;
  if (!kind || !kinds.includes(kind)) {
    return NextResponse.json(
      { ok: false, error: "Loại dữ liệu lọc không hợp lệ" },
      { status: 400 },
    );
  }

  const query = params.get("q")?.trim() ?? "";
  const rows = await getFilterOptions(kind, query);
  return NextResponse.json(
    { ok: true, data: { rows } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function getFilterOptions(kind: FilterOptionKind, query: string) {
  if (kind === "supplier") {
    return db
      .select({ id: suppliers.id, label: suppliers.name, hint: suppliers.phone })
      .from(suppliers)
      .where(query ? accentInsensitiveLike(suppliers.name, query) : undefined)
      .orderBy(asc(suppliers.name))
      .limit(30);
  }
  if (kind === "warehouse") {
    return db
      .select({ id: warehouses.id, label: warehouses.name, hint: warehouses.address })
      .from(warehouses)
      .where(query ? accentInsensitiveLike(warehouses.name, query) : undefined)
      .orderBy(asc(warehouses.name))
      .limit(30);
  }
  if (kind === "category") {
    return db
      .select({ id: categories.id, label: categories.name })
      .from(categories)
      .where(query ? accentInsensitiveLike(categories.name, query) : undefined)
      .orderBy(asc(categories.name))
      .limit(30);
  }
  return db
    .select({ id: brands.id, label: brands.name })
    .from(brands)
    .where(query ? accentInsensitiveLike(brands.name, query) : undefined)
    .orderBy(asc(brands.name))
    .limit(30);
}
