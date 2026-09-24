export type CameraQuoteCopyMode = "camera-only" | "price-summary" | "full";

export function cameraQuoteCopyLayout(mode: CameraQuoteCopyMode) {
  return {
    showPriceSummary: mode !== "camera-only",
    showPriceBreakdown: mode === "full",
  };
}

export type CameraQuoteImageDeliveryResult = "copied" | "downloaded";

export type CameraQuoteImageDeliveryOptions = {
  blob: Blob;
  fileName: string;
  clipboard?: { write(items: unknown[]): Promise<void> };
  clipboardItem?: (blob: Blob) => unknown;
  mobileBridge?: { postMessage(message: string): void };
  toDataUrl?: (blob: Blob) => Promise<string>;
  download: () => void;
};

export async function deliverCameraQuoteImage({
  blob,
  fileName,
  clipboard,
  clipboardItem,
  mobileBridge,
  toDataUrl,
  download,
}: CameraQuoteImageDeliveryOptions): Promise<CameraQuoteImageDeliveryResult> {
  if (clipboard && clipboardItem) {
    try {
      await clipboard.write([clipboardItem(blob)]);
      return "copied";
    } catch {
      // Try the remaining delivery paths.
    }
  }

  if (mobileBridge && toDataUrl) {
    try {
      mobileBridge.postMessage(
        JSON.stringify({
          type: "copy-image",
          fileName,
          mimeType: blob.type || "image/png",
          dataUrl: await toDataUrl(blob),
        }),
      );
      return "copied";
    } catch {
      // Fall back to the browser download when the native bridge is unavailable.
    }
  }

  download();
  return "downloaded";
}
