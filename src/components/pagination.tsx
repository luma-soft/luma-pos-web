"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZES } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";

/**
 * Phân trang dùng chung (kiểu KiotViet): chọn số dòng + |< < [n] > >| + "X–Y trong N".
 * URL-based: cập nhật query `page` / `size`, giữ nguyên các query khác.
 */
export function Pagination({
  page, pageCount, total, pageSize, unitLabel, showRange = true,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  unitLabel?: string;
  showRange?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    const s = sp.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-4 text-sm">
      <div className="flex items-center gap-2">
        <Text variant="muted" text={t("pagination.show")} />
        <Select
          value={pageSize}
          onChange={(e) => go({ size: e.target.value, page: undefined })}
          size="sm"
          options={PAGE_SIZES.map((s) => ({ value: String(s), label: t("pagination.rows", { n: s }) }))}
          className="min-w-[116px]"
        />
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="iconSm" disabled={page <= 1} onClick={() => go({ page: undefined })} title={t("pagination.first")}><ChevronsLeft className="w-4 h-4" /></Button>
        <Button variant="outline" size="iconSm" disabled={page <= 1} onClick={() => go({ page: page - 1 <= 1 ? undefined : String(page - 1) })} title={t("pagination.prev")}><ChevronLeft className="w-4 h-4" /></Button>
        <NumberInput
          min={1} max={pageCount}
          value={page}
          onChange={(value) => {
            const p = Math.min(pageCount, Math.max(1, value ?? 1));
            go({ page: p <= 1 ? undefined : String(p) });
          }}
          thousandSeparator={false}
          size="sm"
          className="w-12 text-center tabular-nums"
        />
        <Button variant="outline" size="iconSm" disabled={page >= pageCount} onClick={() => go({ page: String(page + 1) })} title={t("pagination.next")}><ChevronRight className="w-4 h-4" /></Button>
        <Button variant="outline" size="iconSm" disabled={page >= pageCount} onClick={() => go({ page: String(pageCount) })} title={t("pagination.last")}><ChevronsRight className="w-4 h-4" /></Button>
      </div>

      {showRange && <Text as="div" variant="muted" className="ml-auto sm:ml-0 tabular-nums" text={`${t("pagination.range", { start, end, total })}${unitLabel ? ` ${unitLabel}` : ""}`} />}
    </div>
  );
}
