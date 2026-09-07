import { expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";

import { createLibraryImageArchive, safeLibraryFileName } from "./library-image-actions";

test("download names cannot escape the archive or contain unsafe characters", () => {
  expect(safeLibraryFileName("../../camera:front?.heic", "image")).toBe("camera_front_.heic");
  expect(safeLibraryFileName("..", "image-1")).toBe("image-1");
  expect(safeLibraryFileName("folder\\photo.jpg", "image")).toBe("photo.jpg");
});

test("multi-image downloads preserve duplicate files under unique zip names", async () => {
  const archive = unzipSync(await createLibraryImageArchive([
    new File(["first"], "camera.jpg", { type: "image/jpeg" }),
    new File(["second"], "camera.jpg", { type: "image/jpeg" }),
  ]));

  expect(strFromU8(archive["camera.jpg"])).toBe("first");
  expect(strFromU8(archive["camera-2.jpg"])).toBe("second");
});
