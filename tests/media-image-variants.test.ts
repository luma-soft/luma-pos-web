import { describe, expect, mock, test } from "bun:test";
import sharp from "sharp";

mock.module("server-only", () => ({}));

import {
  createMediaThumbnail,
  isSafeRasterMimeType,
} from "../src/lib/media/image-variants";

describe("media image variants", () => {
  test("applies EXIF rotation, fits inside 640x640, and emits WebP quality output", async () => {
    const orientedJpeg = await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 3,
        background: { r: 220, g: 20, b: 60 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const output = await createMediaThumbnail(orientedJpeg, "image/jpeg");
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(640);
    expect(metadata.orientation).toBeUndefined();
  });

  test("does not enlarge a small raster", async () => {
    const smallPng = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: { r: 10, g: 120, b: 240, alpha: 1 },
      },
    }).png().toBuffer();

    const output = await createMediaThumbnail(smallPng, "image/png");
    const metadata = await sharp(output).metadata();
    expect([metadata.width, metadata.height]).toEqual([120, 80]);
  });

  test("does not pass SVG or unsupported image types into Sharp", async () => {
    expect(isSafeRasterMimeType("image/svg+xml")).toBe(false);
    expect(isSafeRasterMimeType("image/x-icon")).toBe(false);
    expect(isSafeRasterMimeType("image/jpeg")).toBe(true);
    await expect(
      createMediaThumbnail(new TextEncoder().encode("<svg></svg>"), "image/svg+xml"),
    ).rejects.toThrow("Unsupported raster media type");
  });
});
