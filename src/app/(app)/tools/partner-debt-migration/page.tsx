import { notFound } from "next/navigation";
import { requireStoreRole } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function PartnerDebtMigrationPage() {
  const context = await requireStoreRole(["owner"]).catch(() => null);
  if (!context || context.storeSlug !== "hai-dang") notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Sửa schema công nợ production</h1>
      <p className="text-sm text-slate-600">
        Chạy migration đang thiếu bằng runner có tracking và khóa session. Chỉ dùng một lần.
      </p>
      <form method="post" action="/api/internal/partner-debt-migrations">
        <button
          type="submit"
          className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white"
        >
          Chạy migration đang chờ
        </button>
      </form>
    </main>
  );
}
