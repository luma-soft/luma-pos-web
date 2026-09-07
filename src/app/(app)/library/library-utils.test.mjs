import { expect, test } from "bun:test";

import { libraryImageDisplayUrl } from "./library-utils";

const image = {
  id: "source:camera-one",
  fileName: "camera.heic",
  mimeType: "image/heic",
  url: "https://media.example/original",
  thumbnailUrl: null,
};

test("HEIC images without thumbnails use the authenticated browser preview", () => {
  expect(libraryImageDisplayUrl(image)).toBe(
    "/api/mobile/library?preview=source%3Acamera-one",
  );
});

test("an existing browser-compatible thumbnail remains preferred", () => {
  expect(libraryImageDisplayUrl({
    ...image,
    thumbnailUrl: "https://media.example/thumbnail.webp",
  })).toBe("https://media.example/thumbnail.webp");
});
