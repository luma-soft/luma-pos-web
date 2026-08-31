export type CameraQuoteCopyMode = "camera-only" | "price-summary" | "full";

export function cameraQuoteCopyLayout(mode: CameraQuoteCopyMode) {
  return {
    showPriceSummary: mode !== "camera-only",
    showPriceBreakdown: mode === "full",
  };
}
