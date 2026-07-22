export type CameraDescriptionInput = {
  name: string;
  fullCode: string;
  resolution: string;
  lens: string;
  connection: string;
  nightAndProtection: string;
  powerAndStorage: string;
  features: string;
  warrantyMonths?: number;
};

function withoutTrailingPunctuation(value: string) {
  return value.trim().replace(/[.;:,]+$/, "");
}

export function buildCameraProductDescription({
  name,
  fullCode,
  resolution,
  lens,
  connection,
  nightAndProtection,
  powerAndStorage,
  features,
  warrantyMonths = 24,
}: CameraDescriptionInput) {
  return [
    `${withoutTrailingPunctuation(name)} – mã ${withoutTrailingPunctuation(fullCode)}.`,
    `• Độ phân giải: ${withoutTrailingPunctuation(resolution)}.`,
    `• Ống kính / góc nhìn: ${withoutTrailingPunctuation(lens)}.`,
    `• Kết nối: ${withoutTrailingPunctuation(connection)}.`,
    `• Quan sát ban đêm / bảo vệ: ${withoutTrailingPunctuation(nightAndProtection)}.`,
    `• Nguồn / lưu trữ: ${withoutTrailingPunctuation(powerAndStorage)}.`,
    `• Tính năng chính: ${withoutTrailingPunctuation(features)}.`,
    `• Bảo hành: ${warrantyMonths} tháng.`,
  ].join("\n");
}
