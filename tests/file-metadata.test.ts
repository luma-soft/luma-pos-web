import { expect, test } from "bun:test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { extractFileMetadata, metadataFromExif, normalizeMetadataDate, parseRecordedLocation } from "../src/lib/media/file-metadata";

test("capture timestamps preserve offset or unknown time zone and reject impossible dates", () => {
  expect(normalizeMetadataDate("2026:08:01 10:04:05", "+07:00")).toBe("2026-08-01T10:04:05+07:00");
  expect(normalizeMetadataDate("2026:08:01 10:04:05")).toBe("2026-08-01T10:04:05");
  expect(normalizeMetadataDate("2026-08-01 03:04:05 UTC")).toBe("2026-08-01T03:04:05Z");
  expect(normalizeMetadataDate("UTC 2026-08-01 03:04:05")).toBe("2026-08-01T03:04:05Z");
  expect(normalizeMetadataDate("2026-08-01T10:04:05+0700")).toBe("2026-08-01T10:04:05+07:00");
  for (const value of ["2026:02:30 01:00:00", "0000:00:00 00:00:00", "2026-08-01T10:04:05+25:00", "yesterday"]) {
    expect(normalizeMetadataDate(value)).toBeUndefined();
  }
});

test("GPS zero is valid; partial/out-of-range coordinates are never invented", () => {
  expect(metadataFromExif({ latitude: 0, longitude: 0, GPSAltitude: 3, GPSAltitudeRef: 1 })).toEqual({ latitude: 0, longitude: 0, altitude: -3 });
  expect(metadataFromExif({ latitude: 12 })).toEqual({});
  expect(metadataFromExif({ latitude: 91, longitude: 12 })).toEqual({});
  expect(parseRecordedLocation("+10.7626+106.6602+004.5/")).toEqual({ latitude: 10.7626, longitude: 106.6602, altitude: 4.5 });
  expect(parseRecordedLocation("10.7626°S 106.6602°W -4.5m")).toEqual({ latitude: -10.7626, longitude: -106.6602, altitude: -4.5 });
});

test("reads real JPEG EXIF without touching original bytes", async () => {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).jpeg()
    .withExif({ IFD0: { Make: "Luma camera", Model: "Test", Orientation: "6" },
      IFD2: { DateTimeOriginal: "2026:08:01 10:04:05", OffsetTimeOriginal: "+07:00" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" },
    }).toBuffer();
  const copy = Buffer.from(bytes);
  const metadata = await extractFileMetadata({ mimeType: "image/jpeg", sizeBytes: bytes.length, read: async (size, offset) => bytes.subarray(offset, offset + size) });
  expect(metadata).toMatchObject({ status: "ready", width: 32, height: 24, make: "Luma camera", model: "Test", capturedAt: "2026-08-01T10:04:05+07:00", latitude: 0, longitude: 0 });
  expect(bytes).toEqual(copy);
});

test("missing EXIF does not substitute upload/capture time or GPS", async () => {
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "white" } }).png().toBuffer();
  const metadata = await extractFileMetadata({ mimeType: "image/png", sizeBytes: bytes.length, read: async () => bytes });
  expect(metadata).toMatchObject({ status: "ready", width: 4, height: 3 });
  expect(metadata.capturedAt).toBeUndefined();
  expect(metadata.latitude).toBeUndefined();
});

test("unsupported documents and oversized images never read bytes; corrupt input is nonfatal", async () => {
  let reads = 0;
  const read = async () => { reads++; return new Uint8Array(5); };
  expect((await extractFileMetadata({ mimeType: "application/pdf", sizeBytes: 100, read })).status).toBe("unsupported");
  expect((await extractFileMetadata({ mimeType: "image/jpeg", sizeBytes: 26 * 1024 * 1024, read })).status).toBe("failed");
  expect(reads).toBe(0);
  expect((await extractFileMetadata({ mimeType: "image/jpeg", sizeBytes: 5, read })).status).toBe("failed");
});

test("real MP4 records capture offset, GPS, device, dimensions and duration in seconds", async () => {
  const bytes = readFileSync(new URL("./fixtures/media-metadata.mp4", import.meta.url));
  const metadata = await extractFileMetadata({ mimeType: "video/mp4", sizeBytes: bytes.length, read: async (size, offset) => bytes.subarray(offset, offset + size) });
  expect(metadata).toMatchObject({ status: "ready", capturedAt: "2026-08-01T10:04:05+07:00", fileCreatedAt: "2026-08-01T03:04:05Z", latitude: 10.7626, longitude: 106.6602, altitude: 4.5, make: "Apple", model: "iPhone", width: 32, height: 24, durationSeconds: 1, frameRate: 25 });
});

test("seeks to a 512 MB video's trailing metadata without loading the video payload", async () => {
  const fixture = readFileSync(new URL("./fixtures/media-metadata.mp4", import.meta.url));
  let cursor = 0;
  let mdat = 0;
  let moov = 0;
  while (cursor < fixture.length) {
    const name = fixture.toString("ascii", cursor + 4, cursor + 8);
    if (name === "mdat") mdat = cursor;
    if (name === "moov") moov = cursor;
    cursor += fixture.readUInt32BE(cursor);
  }
  expect(mdat).toBeGreaterThan(0);
  expect(moov).toBeGreaterThan(mdat);
  const tail = fixture.subarray(moov);
  const head = Buffer.from(fixture.subarray(0, moov));
  const total = 512 * 1024 * 1024;
  const tailOffset = total - tail.length;
  head.writeUInt32BE(tailOffset - mdat, mdat);
  let readBytes = 0;
  const offsets: number[] = [];
  const metadata = await extractFileMetadata({ mimeType: "video/quicktime", sizeBytes: total,
    read: async (size, offset) => {
      readBytes += size;
      offsets.push(offset);
      const chunk = Buffer.alloc(size);
      for (const [start, source] of [[0, head], [tailOffset, tail]] as const) {
        const first = Math.max(start, offset), last = Math.min(start + source.length, offset + size);
        if (first < last) source.copy(chunk, first - offset, first - start, last - start);
      }
      return chunk;
    },
  });
  expect(metadata).toMatchObject({ status: "ready", width: 32, height: 24, durationSeconds: 1, latitude: 10.7626 });
  expect(readBytes).toBeLessThan(1024 * 1024);
  expect(Math.max(...offsets)).toBeGreaterThan(500 * 1024 * 1024);
});
