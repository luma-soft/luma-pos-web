import sharp from "sharp";

export async function convertHeifToJpeg(bytes: Uint8Array) {
  return sharp(bytes).rotate().jpeg({ quality: 88 }).toBuffer();
}
