export function estimateStorageDays(capacityGb: number | null, megapixels: number) {
  if (!capacityGb) return "Liên hệ để tư vấn";
  // Estimated H.265 continuous recording. Adaptive bitrate, frame rate, scene
  // activity and multi-lens cameras can move real retention within this range.
  const gigabytesPerDay = megapixels <= 2 ? [8, 11]
    : megapixels <= 3 ? [13, 21]
      : megapixels <= 5 ? [21, 32]
        : [32, 64];
  const shortestDays = Math.max(1, Math.round(capacityGb / gigabytesPerDay[1]));
  const longestDays = Math.max(shortestDays, Math.round(capacityGb / gigabytesPerDay[0]));
  return `~${shortestDays}–${longestDays} ngày`;
}
