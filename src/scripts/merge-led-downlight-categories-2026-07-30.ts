import { eq, ilike, inArray } from "drizzle-orm";
import { db } from "../db";
import { categories, modifierGroups, products } from "../db/schema";

const targetName = "Đèn LED Downlight âm trần";
const mergedNames = new Set([
  "Đèn Downlight",
  targetName,
  "Đèn LED Downlight âm trần diệt khuẩn",
  "Đèn LED Downlight âm trần đổi màu",
  "Đèn LED Downlight âm trần dự phòng",
  "Đèn LED Downlight âm trần góc rộng",
]);

async function main() {
  const matches = await db
    .select({
      id: categories.id,
      name: categories.name,
    })
    .from(categories)
    .where(ilike(categories.name, "%downlight%"));

  const unexpectedNames = matches
    .map((category) => category.name)
    .filter((name) => !mergedNames.has(name));
  if (unexpectedNames.length > 0) {
    throw new Error(
      `Có danh mục Downlight ngoài danh sách dự kiến: ${unexpectedNames.join(", ")}`,
    );
  }

  const targets = matches.filter((category) => category.name === targetName);
  if (targets.length !== 1) {
    throw new Error(
      `Cần đúng 1 danh mục đích "${targetName}", hiện có ${targets.length}`,
    );
  }

  const targetId = targets[0].id;
  const sourceIds = matches
    .filter((category) => category.id !== targetId)
    .map((category) => category.id);

  const result = await db.transaction(async (tx) => {
    if (sourceIds.length === 0) {
      return { movedProducts: 0, deletedCategories: 0 };
    }

    const movedProducts = await tx
      .update(products)
      .set({ categoryId: targetId })
      .where(inArray(products.categoryId, sourceIds))
      .returning({ id: products.id });

    await tx
      .update(categories)
      .set({ parentId: targetId })
      .where(inArray(categories.parentId, sourceIds));

    const groups = await tx
      .select({
        id: modifierGroups.id,
        categoryIds: modifierGroups.categoryIds,
      })
      .from(modifierGroups);
    for (const group of groups) {
      if (!group.categoryIds.some((id) => sourceIds.includes(id))) continue;
      const categoryIds = Array.from(
        new Set(
          group.categoryIds.map((id) =>
            sourceIds.includes(id) ? targetId : id,
          ),
        ),
      );
      await tx
        .update(modifierGroups)
        .set({ categoryIds })
        .where(eq(modifierGroups.id, group.id));
    }

    const deletedCategories = await tx
      .delete(categories)
      .where(inArray(categories.id, sourceIds))
      .returning({ id: categories.id });

    return {
      movedProducts: movedProducts.length,
      deletedCategories: deletedCategories.length,
    };
  });

  const remainingCategories = await db
    .select({
      id: categories.id,
      name: categories.name,
    })
    .from(categories)
    .where(ilike(categories.name, "%downlight%"));
  const targetProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, targetId));

  if (
    remainingCategories.length !== 1 ||
    remainingCategories[0].id !== targetId
  ) {
    throw new Error("Xác minh thất bại: vẫn còn danh mục Downlight trùng");
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        targetCategory: remainingCategories[0],
        targetProductCount: targetProducts.length,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
