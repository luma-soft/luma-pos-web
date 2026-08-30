export const bookingStatusOptions = [
  { value: "all", label: "Tất cả" },
  { value: "confirmed", label: "Đang chờ" },
  { value: "completed", label: "Hoàn thành" },
  { value: "draft", label: "Phiếu tạm" },
  { value: "cancelled", label: "Đã hủy" },
] as const;

export type BookingStatusFilter = typeof bookingStatusOptions[number]["value"];

export function resolveBookingStatus(value: string | undefined): BookingStatusFilter {
  return bookingStatusOptions.some((option) => option.value === value)
    ? value as BookingStatusFilter
    : "all";
}
