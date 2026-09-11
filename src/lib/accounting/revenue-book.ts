import type { StorePrefs } from "@/lib/schemas/settings";

export const REVENUE_BOOK_CODES = ["S1a-HKD", "S2a-HKD", "S2b-HKD"] as const;
export type RevenueBookCode = (typeof REVENUE_BOOK_CODES)[number];

export type RevenueBookDefinition = {
  code: RevenueBookCode;
  title: string;
  description: string;
};

export function resolveRevenueBook(
  method: StorePrefs["tax"]["calculationMethod"],
): RevenueBookDefinition | null {
  if (method === "non_taxable") {
    return {
      code: "S1a-HKD",
      title: "Sổ doanh thu bán hàng hóa, dịch vụ",
      description: "Dành cho hộ, cá nhân kinh doanh không chịu thuế GTGT và không phải nộp thuế TNCN.",
    };
  }
  if (method === "revenue_percentage") {
    return {
      code: "S2a-HKD",
      title: "Sổ doanh thu bán hàng hóa, dịch vụ",
      description: "Doanh thu được theo dõi theo phương pháp tính thuế trên tỷ lệ doanh thu.",
    };
  }
  if (method === "taxable_income") {
    return {
      code: "S2b-HKD",
      title: "Sổ chi tiết doanh thu bán hàng hóa, dịch vụ",
      description: "Sổ doanh thu thuộc bộ sổ dành cho phương pháp tính thuế theo thu nhập chịu thuế.",
    };
  }
  return null;
}

