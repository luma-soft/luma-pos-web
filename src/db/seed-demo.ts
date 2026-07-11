/**
 * Seed DEMO DATA khớp với design mockup (design/dashboard.html).
 * Run: bun db:seed-demo
 * An toàn: chỉ chạy khi bảng orders trống; catalog upsert theo SKU/tên.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  brands, categories, customers, orders, orderItems, payments, products,
  projects, stockLevels, warehouses, cashTransactions,
  marketplaceShops, marketplaceTokens, marketplaceProductMappings,
  marketplaceOrderMappings, marketplaceMessageThreads, marketplaceMessages,
  marketplaceSyncJobs,
} from "./schema";

const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(4);

async function findOrCreate<T extends { id: string }>(
  rows: T[], match: (r: T) => boolean, create: () => Promise<T>
): Promise<T> {
  return rows.find(match) ?? (await create());
}

async function seedDemo() {
  const [{ c: orderCount }] = await db.select({ c: sql<number>`count(*)::int` }).from(orders);
  if (orderCount > 0) {
    console.log("⚠️  DB đã có đơn hàng — chỉ bổ sung demo Bán online/Shopee nếu thiếu.");
    await seedMarketplaceDemo();
    process.exit(0);
  }

  console.log("🌱 Seeding demo data (khớp design)...");

  // ===== Kho =====
  const whs = await db.select().from(warehouses);
  const whShop = await findOrCreate(whs, (w) => w.isDefault, async () =>
    (await db.insert(warehouses).values({ name: "Kho cửa hàng", isDefault: true }).returning())[0]);
  await findOrCreate(whs, (w) => w.name === "Kho bãi", async () =>
    (await db.insert(warehouses).values({ name: "Kho bãi" }).returning())[0]);

  // ===== Danh mục + brand =====
  const catNames = ["Gạch ốp lát", "Xi măng – cát đá", "Sắt thép", "Ống nước", "Thiết bị vệ sinh", "Thiết bị bếp", "Sơn"];
  const existingCats = await db.select().from(categories);
  const cat: Record<string, string> = {};
  for (const name of catNames) {
    const found = existingCats.find((c) => c.name === name)
      ?? (await db.insert(categories).values({ name }).returning())[0];
    cat[name] = found.id;
  }
  await db.insert(brands).values(
    ["Đồng Tâm", "Hà Tiên", "Pomina", "Bình Minh", "TOTO", "INAX", "Rinnai", "Dulux", "Tân Á"].map((name) => ({ name }))
  ).onConflictDoNothing();

  // ===== Sản phẩm (theo design) =====
  // [sku, name, cat, baseUnit, cost, retail, contractor, stockShop, minLevel, m2PerUnit]
  const P: [string, string, string, string, number, number, number, number, number, number | null][] = [
    ["DT6060", "Gạch lát 60×60 Đồng Tâm DT6060", "Gạch ốp lát", "viên", 57750, 72000, 66000, 48, 200, 0.36],
    ["HT-PCB40", "Xi măng Hà Tiên PCB40 50kg", "Xi măng – cát đá", "bao", 84500, 92000, 87000, 23, 100, null],
    ["PM-D10", "Thép Pomina D10", "Sắt thép", "cây", 147000, 152000, 147500, 320, 80, null],
    ["BM-O27", "Ống PVC Bình Minh Ø27 ×4m", "Ống nước", "cây", 35000, 38500, 36500, 35, 60, null],
    ["DLX-INS18", "Sơn Dulux Inspire nội thất 18L", "Sơn", "thùng", 980000, 1250000, 1180000, 18, 5, null],
    ["TOTO-3302", "Vòi sen TOTO TBS03302V", "Thiết bị vệ sinh", "bộ", 1480000, 1890000, 1750000, 4, 10, null],
    ["INAX-700", "Bồn cầu INAX AC-700VAN", "Thiết bị vệ sinh", "bộ", 2460000, 3150000, 3000000, 7, 2, null],
    ["TA-1000", "Bồn nước Tân Á 1000L đứng", "Thiết bị nước" in cat ? "Thiết bị nước" : "Ống nước", "cái", 1980000, 2480000, 2350000, 5, 2, null],
    ["RIN-2BG", "Bếp gas âm Rinnai RVB-2BG", "Thiết bị bếp", "cái", 2300000, 2950000, 2780000, 6, 2, null],
    ["TUY-8818", "Gạch ống 8×8×18 Tuynel", "Gạch ốp lát", "viên", 1100, 1450, 1300, 12500, 3000, null],
  ];

  const prodId: Record<string, string> = {};
  for (const [sku, name, catName, baseUnit, cost, retail, contractor, stock, min, m2] of P) {
    const [existing] = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
    const row = existing ?? (await db.insert(products).values({
      sku, name, categoryId: cat[catName], baseUnit,
      costPrice: money(cost), retailPrice: money(retail),
      contractorPrice: money(contractor), wholesalePrice: money(Math.round(retail * 0.96)),
      agentPrice: money(Math.round(retail * 0.93)),
      m2PerUnit: m2 != null ? qty(m2) : null,
    }).returning())[0];
    prodId[sku] = row.id;
    await db.insert(stockLevels).values({
      productId: row.id, warehouseId: whShop.id, quantity: qty(stock), minLevel: qty(min),
    }).onConflictDoNothing();
  }

  // ===== Khách hàng =====
  const C: [string, string, "retail" | "wholesale" | "contractor" | "agent", number][] = [
    ["KH-TUAN", "Anh Tuấn", "contractor", 60_000_000],
    ["KH-MPHAT", "Cty XD Minh Phát", "wholesale", 100_000_000],
    ["KH-BAY", "Anh Bảy — VLXD Bảy Hiền", "agent", 80_000_000],
    ["KH-LAN", "Chị Lan", "retail", 0],
    ["KH-HONG", "Chị Hồng", "retail", 0],
  ];
  const custId: Record<string, string> = {};
  for (const [code, name, type, limit] of C) {
    const [existing] = await db.select().from(customers).where(eq(customers.code, code)).limit(1);
    const row = existing ?? (await db.insert(customers).values({
      code, name, type, debtLimit: money(limit), phone: "09" + String(Math.abs(hash(code))).slice(0, 8),
    }).returning())[0];
    custId[code] = row.id;
  }

  // ===== Công trình =====
  const [pjHung] = await db.insert(projects).values({ name: "Nhà a. Hùng, Q.7", customerId: custId["KH-TUAN"], address: "25/3 Lâm Văn Bền, Q.7" }).returning();
  const [pjSky] = await db.insert(projects).values({ name: "CC Sky Garden — block B", customerId: custId["KH-MPHAT"], address: "Q.2, TP.HCM" }).returning();

  // ===== Đơn hàng 7 ngày (chart theo design ≈ 28,4/39,1/33/53,2/43,6/67,5/13,6 triệu) =====
  // offset: 6 = 6 ngày trước … 0 = hôm nay
  type O = { offset: number; cust: string | null; total: number; paid: number; project?: string; note?: string };
  const ORDERS: O[] = [
    // ngày -6
    { offset: 6, cust: "KH-LAN", total: 18_400_000, paid: 18_400_000 },
    { offset: 6, cust: null, total: 10_000_000, paid: 10_000_000 },
    // ngày -5: Tuấn nợ 32,88tr
    { offset: 5, cust: "KH-TUAN", total: 32_880_000, paid: 0, project: "hung" },
    { offset: 5, cust: null, total: 6_220_000, paid: 6_220_000 },
    // ngày -4: Minh Phát nợ 22,28tr
    { offset: 4, cust: "KH-MPHAT", total: 22_280_000, paid: 0, project: "sky" },
    { offset: 4, cust: "KH-HONG", total: 10_720_000, paid: 10_720_000 },
    // ngày -3: Bảy nợ 28,25tr
    { offset: 3, cust: "KH-BAY", total: 28_250_000, paid: 0 },
    { offset: 3, cust: null, total: 24_950_000, paid: 24_950_000 },
    // ngày -2
    { offset: 2, cust: "KH-LAN", total: 43_600_000, paid: 43_600_000 },
    // ngày -1: Minh Phát nợ 64,12tr
    { offset: 1, cust: "KH-MPHAT", total: 64_120_000, paid: 0, project: "sky" },
    { offset: 1, cust: null, total: 3_380_000, paid: 3_380_000 },
    // hôm nay: Tuấn cọc 50% đơn 18,54tr
    { offset: 0, cust: "KH-TUAN", total: 18_540_000, paid: 9_270_000, project: "hung" },
    { offset: 0, cust: null, total: 2_350_000, paid: 2_350_000 },
  ];

  const debtAcc: Record<string, number> = {};
  const spentAcc: Record<string, number> = {};
  let n = 0;
  for (const o of ORDERS) {
    n++;
    const d = new Date();
    d.setDate(d.getDate() - o.offset);
    d.setHours(10 + (n % 6), 15 + (n * 7) % 40, 0, 0);

    // 1 dòng xi măng + 1 dòng gạch viên cho chẵn tiền
    const xmQty = Math.floor((o.total * 0.6) / 92000);
    const xmTotal = xmQty * 92000;
    const gachTotal = o.total - xmTotal;
    const gachQty = Math.round(gachTotal / 72000 * 10000) / 10000;

    const paymentStatus = o.paid >= o.total ? "paid" : o.paid > 0 ? "deposit" : "unpaid";
    const [ord] = await db.insert(orders).values({
      code: `DH-DEMO-${String(n).padStart(3, "0")}`,
      status: "completed",
      paymentStatus,
      customerId: o.cust ? custId[o.cust] : null,
      warehouseId: whShop.id,
      projectId: o.project === "hung" ? pjHung.id : o.project === "sky" ? pjSky.id : null,
      projectName: o.project === "hung" ? "Nhà a. Hùng, Q.7" : o.project === "sky" ? "CC Sky Garden" : null,
      subtotal: money(o.total), total: money(o.total), amountPaid: money(o.paid),
      createdAt: d,
    }).returning();

    await db.insert(orderItems).values([
      { orderId: ord.id, productId: prodId["HT-PCB40"], productName: "Xi măng Hà Tiên PCB40 50kg", unitName: "bao", unitMultiplier: qty(1), quantity: qty(xmQty), unitPrice: money(92000), total: money(xmTotal) },
      { orderId: ord.id, productId: prodId["DT6060"], productName: "Gạch lát 60×60 Đồng Tâm DT6060", unitName: "viên", unitMultiplier: qty(1), quantity: qty(gachQty), unitPrice: money(72000), total: money(gachTotal) },
    ]);

    if (o.paid > 0) {
      await db.insert(payments).values({ orderId: ord.id, amount: money(o.paid), method: "cash", createdAt: d });
      await db.insert(cashTransactions).values({
        code: `PT-DEMO-${String(n).padStart(3, "0")}`, type: "in", fund: "cash",
        amount: money(o.paid), category: paymentStatus === "paid" ? "sale" : "sale",
        refType: "order", refId: ord.id, note: ord.code, createdAt: d,
      });
    }
    if (o.cust) {
      debtAcc[o.cust] = (debtAcc[o.cust] ?? 0) + (o.total - o.paid);
      spentAcc[o.cust] = (spentAcc[o.cust] ?? 0) + o.total;
    }
  }

  for (const [code, debt] of Object.entries(debtAcc)) {
    await db.update(customers).set({
      currentDebt: money(debt),
      totalSpent: money(spentAcc[code] ?? 0),
    }).where(eq(customers.id, custId[code]));
  }

  console.log(`✅ Demo: ${ORDERS.length} đơn / 7 ngày, công nợ Tuấn ${(debtAcc["KH-TUAN"] / 1e6).toFixed(2)}tr · Minh Phát ${(debtAcc["KH-MPHAT"] / 1e6).toFixed(2)}tr · Bảy ${(debtAcc["KH-BAY"] / 1e6).toFixed(2)}tr`);
  await seedMarketplaceDemo();
  console.log("   Dashboard giờ sẽ hiển thị giống design mockup.");
  process.exit(0);
}

async function seedMarketplaceDemo() {
  const productRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      retailPrice: products.retailPrice,
      totalStock: products.totalStock,
      categoryName: sql<string | null>`(select name from categories where id = ${products.categoryId} limit 1)`,
    })
    .from(products)
    .orderBy(products.createdAt)
    .limit(3);
  if (productRows.length === 0) {
    console.log("   ⚠️  Chưa có sản phẩm nên bỏ qua demo Shopee.");
    return;
  }

  const [shop] = await db.insert(marketplaceShops)
    .values({
      provider: "shopee",
      shopId: "demo-review-shop",
      shopName: "Shopee Demo Review Shop",
      region: "VN",
      status: "connected",
      connectedAt: new Date(),
      tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      metadata: {
        mode: "demo",
        reviewAccount: true,
        note: "Demo shop for Shopee Open Platform reviewer trial account.",
      },
    })
    .onConflictDoUpdate({
      target: [marketplaceShops.provider, marketplaceShops.shopId],
      set: {
        shopName: "Shopee Demo Review Shop",
        status: "connected",
        disconnectedAt: null,
        lastError: null,
        metadata: {
          mode: "demo",
          reviewAccount: true,
          note: "Demo shop for Shopee Open Platform reviewer trial account.",
        },
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: marketplaceShops.id });

  await db.insert(marketplaceTokens).values({
    shopId: shop.id,
    accessToken: "demo-access-token",
    refreshToken: "demo-refresh-token",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    scopes: ["product", "order", "chat", "logistics"],
  }).onConflictDoUpdate({
    target: [marketplaceTokens.shopId],
    set: {
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      scopes: ["product", "order", "chat", "logistics"],
      updatedAt: sql`now()`,
    },
  });

  for (const [index, product] of productRows.entries()) {
    const categoryId = index === 0 ? "1000160101" : index === 1 ? "1000160102" : "1000100101";
    const categoryPath = index === 0
      ? "Nhà Cửa & Đời Sống/Vật liệu xây dựng/Gạch ốp lát"
      : index === 1
        ? "Nhà Cửa & Đời Sống/Vật liệu xây dựng/Ống nước & phụ kiện"
        : "Thiết Bị Điện Gia Dụng/Thiết bị điện/Át cài / CB điện";
    const status = index === 0 ? "published" : index === 1 ? "draft" : "ready";
    const externalItemId = status === "published" ? `demo-item-${product.sku}` : null;
    const payload = {
      provider: "shopee",
      demo: true,
      productId: product.id,
      shopId: shop.id,
      title: product.name,
      sku: product.sku,
      categoryId,
      categoryPath,
      price: Number(product.retailPrice),
      stock: Number(product.totalStock),
      logisticId: "5001",
      attributes: {
        brand: "Demo Brand",
        categoryPath,
        material: product.categoryName ?? "VLXD",
      },
    };
    const [mapping] = await db.insert(marketplaceProductMappings)
      .values({
        provider: "shopee",
        shopId: shop.id,
        productId: product.id,
        externalItemId,
        externalSku: product.sku,
        status,
        title: product.name,
        categoryId,
        categoryPath,
        price: money(Number(product.retailPrice)),
        stock: qty(Number(product.totalStock)),
        syncMode: "luma_to_shopee",
        draftPayload: payload,
        lastPayload: status === "published" ? payload : null,
        lastResponse: status === "published" ? { status: "demo_synced", externalItemId, message: "Demo listing visible for Shopee review." } : null,
        lastSyncAt: status === "published" ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [marketplaceProductMappings.provider, marketplaceProductMappings.productId],
        set: {
          shopId: shop.id,
          externalItemId,
          externalSku: product.sku,
          status,
          title: product.name,
          categoryId,
          categoryPath,
          price: money(Number(product.retailPrice)),
          stock: qty(Number(product.totalStock)),
          draftPayload: payload,
          lastPayload: status === "published" ? payload : null,
          lastResponse: status === "published" ? { status: "demo_synced", externalItemId, message: "Demo listing visible for Shopee review." } : null,
          lastSyncAt: status === "published" ? new Date() : null,
          lastError: null,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: marketplaceProductMappings.id });

    await db.insert(marketplaceSyncJobs).values({
      provider: "shopee",
      shopId: shop.id,
      jobType: status === "published" ? "listing_publish" : "listing_validate",
      status: status === "published" ? "completed" : "pending",
      idempotencyKey: `demo:shopee:${product.sku}:${status}`,
      payload: { ...payload, mappingId: mapping.id },
      lastResponse: status === "published" ? { status: "ok", message: "Demo sync completed." } : null,
    }).onConflictDoUpdate({
      target: [marketplaceSyncJobs.provider, marketplaceSyncJobs.idempotencyKey],
      set: {
        shopId: shop.id,
        status: status === "published" ? "completed" : "pending",
        payload: { ...payload, mappingId: mapping.id },
        lastResponse: status === "published" ? { status: "ok", message: "Demo sync completed." } : null,
        updatedAt: sql`now()`,
      },
    });
  }

  const [order] = await db.select({ id: orders.id, code: orders.code }).from(orders).orderBy(sql`${orders.createdAt} desc`).limit(1);
  if (order) {
    await db.insert(marketplaceOrderMappings).values({
      provider: "shopee",
      shopId: shop.id,
      orderId: order.id,
      externalOrderSn: "SHP-DEMO-ORDER-001",
      externalStatus: "READY_TO_SHIP",
      rawPayload: {
        demo: true,
        order_sn: "SHP-DEMO-ORDER-001",
        status: "READY_TO_SHIP",
        lumaOrderCode: order.code,
      },
    }).onConflictDoUpdate({
      target: [marketplaceOrderMappings.provider, marketplaceOrderMappings.externalOrderSn],
      set: {
        shopId: shop.id,
        orderId: order.id,
        externalStatus: "READY_TO_SHIP",
        updatedAt: sql`now()`,
      },
    });

    await db.insert(marketplaceSyncJobs).values({
      provider: "shopee",
      shopId: shop.id,
      jobType: "order_import",
      status: "completed",
      idempotencyKey: "demo:shopee:order:SHP-DEMO-ORDER-001",
      payload: { demo: true, orderSn: "SHP-DEMO-ORDER-001", lumaOrderId: order.id },
      lastResponse: { status: "ok", message: "Demo Shopee order imported into LumaPOS." },
    }).onConflictDoUpdate({
      target: [marketplaceSyncJobs.provider, marketplaceSyncJobs.idempotencyKey],
      set: {
        shopId: shop.id,
        status: "completed",
        payload: { demo: true, orderSn: "SHP-DEMO-ORDER-001", lumaOrderId: order.id },
        lastResponse: { status: "ok", message: "Demo Shopee order imported into LumaPOS." },
        updatedAt: sql`now()`,
      },
    });

    const [thread] = await db.insert(marketplaceMessageThreads).values({
      provider: "shopee",
      shopId: shop.id,
      externalThreadId: "SHP-DEMO-THREAD-001",
      externalBuyerId: "demo-buyer-001",
      buyerName: "Shopee demo buyer",
      orderId: order.id,
      status: "open",
      lastMessageAt: new Date(),
      metadata: { demo: true, reviewAccount: true },
    }).onConflictDoUpdate({
      target: [marketplaceMessageThreads.provider, marketplaceMessageThreads.externalThreadId],
      set: {
        shopId: shop.id,
        orderId: order.id,
        status: "open",
        lastMessageAt: new Date(),
        updatedAt: sql`now()`,
      },
    }).returning({ id: marketplaceMessageThreads.id });

    await db.insert(marketplaceMessages).values([
      {
        threadId: thread.id,
        externalMessageId: "SHP-DEMO-MSG-001",
        direction: "in",
        body: "Shop ơi đơn này khi nào giao?",
        rawPayload: { demo: true },
        sentAt: new Date(Date.now() - 1000 * 60 * 12),
      },
      {
        threadId: thread.id,
        externalMessageId: "SHP-DEMO-MSG-002",
        direction: "out",
        body: "LumaPOS đã nhận đơn Shopee, kho đang chuẩn bị hàng và sẽ cập nhật vận chuyển trong hôm nay.",
        rawPayload: { demo: true, queuedToShopee: true },
        sentAt: new Date(Date.now() - 1000 * 60 * 5),
      },
    ]).onConflictDoNothing();
  }

  console.log("   ✅ Demo Shopee: shop, listings, sync logs, order mapping và inbox đã sẵn sàng.");
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h || 1;
}

seedDemo().catch((e) => {
  console.error(e);
  process.exit(1);
});
