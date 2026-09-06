import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatNumber(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(n);
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Tính số viên gạch từ diện tích phòng */
export function tilesNeededFor(roomM2: number, m2PerUnit: number, wastePct = 5): number {
  const exact = roomM2 / m2PerUnit;
  return Math.ceil(exact * (1 + wastePct / 100));
}
