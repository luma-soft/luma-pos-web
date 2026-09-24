import { expect, test } from "bun:test";

import { deliverCameraQuoteImage } from "./camera-quote-copy.ts";

test("mobile image bridge is preferred over a blob download", async () => {
  const messages = [];
  let downloads = 0;

  const result = await deliverCameraQuoteImage({
    blob: new Blob(["png"], { type: "image/png" }),
    fileName: "bao-gia-camera.png",
    mobileBridge: {
      postMessage(message) {
        messages.push(JSON.parse(message));
      },
    },
    toDataUrl: async () => "data:image/png;base64,cG5n",
    download: () => {
      downloads += 1;
    },
  });

  expect(result).toBe("copied");
  expect(downloads).toBe(0);
  expect(messages).toEqual([
    {
      type: "copy-image",
      fileName: "bao-gia-camera.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,cG5n",
    },
  ]);
});
