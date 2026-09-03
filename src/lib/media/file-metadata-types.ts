/** Metadata read from the stored original, never from the device's current location. */
export type MediaFileMetadata = {
  version: 1;
  status: "ready" | "empty" | "unsupported" | "failed";
  extractedAt: string;
  /** ISO date/time. No suffix means the source did not record a time zone. */
  capturedAt?: string;
  fileCreatedAt?: string;
  fileModifiedAt?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  width?: number;
  height?: number;
  orientation?: number;
  durationSeconds?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  format?: string;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
};
