import { notFound } from "next/navigation";
import { requireStoreRole } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function FinancialVoucherMigrationPage() {
  const context = await requireStoreRole(["owner"]).catch(() => null);
  if (!context || context.storeSlug !== "hai-dang") notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Cập nhật schema phiếu thu chi</h1>
      <p className="text-sm text-slate-600">
        Chạy migration có tracking, advisory lock và kiểm tra session connection. Dùng một lần cho production.
      </p>
      <form method="post" action="/api/internal/financial-voucher-migrations">
        <button
          type="submit"
          className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white"
        >
          Chạy migration
        </button>
      </form>
    </main>
  );
}
