export const CAMERA_IP_QUOTE_CAMERA_TYPES = [
  "bullet2",
  "bullet4",
  "dome4",
  "ptz4",
] as const;

export type CameraIpQuoteCameraType = (typeof CAMERA_IP_QUOTE_CAMERA_TYPES)[number];

export const CAMERA_IP_QUOTE_SYSTEM_SIZES = ["4", "8", "16"] as const;
export type CameraIpQuoteSystemSize = (typeof CAMERA_IP_QUOTE_SYSTEM_SIZES)[number];

export const CAMERA_IP_QUOTE_POE_METHODS = ["nvr", "switch"] as const;
export type CameraIpQuotePoeMethod = (typeof CAMERA_IP_QUOTE_POE_METHODS)[number];

export const CAMERA_IP_QUOTE_STORAGE_SIZES = ["1", "2", "4", "6"] as const;

export const CAMERA_IP_QUOTE_LEGACY_SKUS = {
  camera: {
    bullet2: "HK-IP-DS2CD1023G2-LIUF",
    bullet4: "HK-IP-DS2CD1043G2-LIUF",
    dome4: "HK-IP-DS2CD1143G2-LIUF",
    ptz4: "HK-PTZ-DS2DE2A404IW-DE3",
  },
  recorder: {
    "4:nvr": "HK-NVR-DS7604NI-K1-4P",
    "4:switch": "HK-NVR-DS7604NI-K1",
    "8:nvr": "HK-NVR-DS7608NI-K1-8P",
    "8:switch": "HK-NVR-DS7608NI-K1",
    "16:nvr": "HK-NVR-DS7616NI-K2-16P",
    "16:switch": "HK-NVR-DS7616NI-K1",
  },
  switch: {
    "4": "HK-SW-DS3E0106P-EM",
    "8": "HK-SW-DS3E1310P-EIM",
    "16": "HK-SW-DS3E1518P-SI",
  },
  storage: {
    "1": "SG-SKYHAWK-1TB",
    "2": "SG-SKYHAWK-2TB",
    "4": "SG-SKYHAWK-4TB",
    "6": "SG-SKYHAWK-6TB",
  },
  material: "MAT-HIK-IP-PER-CAMERA",
  installation: "SVC-HIK-IP-INSTALL-PER-CAMERA",
  ups: "UPS-HIK-650VA",
  cable: "504585",
  rack: "ACC-HIK-RACK-6U",
  monitor: "ACC-HIK-MONITOR-22",
  surge: "ACC-HIK-SURGE-PER-CAMERA",
} as const;

const unique = (values: string[]) => [...new Set(values)];

export const CAMERA_IP_QUOTE_SKUS = unique([
  ...Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.camera),
  ...Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.recorder),
  ...Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.switch),
  ...Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.storage),
  CAMERA_IP_QUOTE_LEGACY_SKUS.material,
  CAMERA_IP_QUOTE_LEGACY_SKUS.installation,
  CAMERA_IP_QUOTE_LEGACY_SKUS.ups,
  CAMERA_IP_QUOTE_LEGACY_SKUS.cable,
  CAMERA_IP_QUOTE_LEGACY_SKUS.rack,
  CAMERA_IP_QUOTE_LEGACY_SKUS.monitor,
  CAMERA_IP_QUOTE_LEGACY_SKUS.surge,
]);

export const CAMERA_IP_QUOTE_RECORDER_KEYS = Object.keys(
  CAMERA_IP_QUOTE_LEGACY_SKUS.recorder,
) as Array<keyof typeof CAMERA_IP_QUOTE_LEGACY_SKUS.recorder>;

export const CAMERA_IP_QUOTE_SWITCH_KEYS = Object.keys(
  CAMERA_IP_QUOTE_LEGACY_SKUS.switch,
) as Array<keyof typeof CAMERA_IP_QUOTE_LEGACY_SKUS.switch>;

export const CAMERA_IP_QUOTE_STORAGE_KEYS = Object.keys(
  CAMERA_IP_QUOTE_LEGACY_SKUS.storage,
) as Array<keyof typeof CAMERA_IP_QUOTE_LEGACY_SKUS.storage>;
