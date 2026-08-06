import { NextResponse } from "next/server";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, products, projects, warehouses } from "@/db/schema";
import { requireSalesAccess } from "@/lib/actions/common";
import { accentInsensitiveLike } from "@/lib/search";

const kinds = ["customer", "product", "project", "order", "warehouse"] as const;
type FilterOptionKind = (typeof kinds)[number];

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
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
  if (kind === "customer") {
    const match = query
      ? or(
          accentInsensitiveLike(customers.name, query),
          accentInsensitiveLike(customers.phone, query),
          accentInsensitiveLike(customers.code, query),
        )
      : undefined;
    return db
      .select({ id: customers.id, label: customers.name, hint: customers.phone })
      .from(customers)
      .where(match)
      .orderBy(desc(customers.createdAt))
      .limit(30);
  }
  if (kind === "product") {
    const match = query
      ? or(
          accentInsensitiveLike(products.name, query),
          accentInsensitiveLike(products.sku, query),
          accentInsensitiveLike(products.barcode, query),
        )
      : undefined;
    return db
      .select({ id: products.id, label: products.name, hint: products.sku })
      .from(products)
      .where(match)
      .orderBy(desc(products.createdAt))
      .limit(30);
  }
  if (kind === "project") {
    const match = query
      ? or(
          accentInsensitiveLike(projects.name, query),
          accentInsensitiveLike(projects.address, query),
        )
      : undefined;
    return db
      .select({ id: projects.id, label: projects.name, hint: projects.address })
      .from(projects)
      .where(match)
      .orderBy(desc(projects.createdAt))
      .limit(30);
  }
  if (kind === "warehouse") {
    const match = query ? accentInsensitiveLike(warehouses.name, query) : undefined;
    return db
      .select({ id: warehouses.id, label: warehouses.name, hint: warehouses.address })
      .from(warehouses)
      .where(match)
      .orderBy(warehouses.name)
      .limit(30);
  }

  const match = query
    ? or(
        accentInsensitiveLike(orders.code, query),
        accentInsensitiveLike(customers.name, query),
      )
    : undefined;
  return db
    .select({ id: orders.id, label: orders.code, hint: customers.name })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.documentType, "sale"),
        match,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(30);
}
