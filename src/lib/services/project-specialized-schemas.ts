import { z } from "zod";
import { concreteServiceTypeSchema } from "@/lib/services/schemas";

const optionalText = (max = 500) => z.string().trim().max(max).optional().default("");
const optionalPort = z.union([z.coerce.number().int().min(1).max(65535), z.literal(""), z.null()])
  .optional()
  .transform((value) => value === "" || value == null ? null : value);

export const cameraVaultPayloadSchema = z.object({
  username: optionalText(200),
  password: optionalText(500),
  verificationCode: optionalText(500),
  encryptionKey: optionalText(1000),
  ddnsProvider: optionalText(120),
  ddnsDomain: optionalText(255),
  ddnsUsername: optionalText(200),
  ddnsPassword: optionalText(500),
  wanIp: optionalText(255),
  httpPort: optionalPort,
  rtspPort: optionalPort,
  onvifPort: optionalPort,
  directUrl: z.union([z.string().trim().url().max(2000), z.literal("")]).optional().default(""),
});

export type CameraVaultPayload = z.output<typeof cameraVaultPayloadSchema>;

const evidenceSchema = z.object({
  label: z.string().trim().min(1).max(160),
  url: z.string().trim().url().max(2000),
  capturedAt: z.iso.datetime().optional(),
}).strict();

const measurementSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  value: z.union([z.number(), z.string().trim().max(200)]),
  unit: z.string().trim().max(40).optional(),
  passed: z.boolean().optional(),
}).strict();

const tradeRecordBase = z.object({
  safety: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    completed: z.boolean(),
  }).strict()).max(80).default([]),
  measurements: z.array(measurementSchema).max(120).default([]),
  evidence: z.array(evidenceSchema).max(80).default([]),
  documents: z.array(evidenceSchema).max(40).default([]),
  note: optionalText(4000),
});

export const serviceTradeRecordSchema = z.discriminatedUnion("serviceType", [
  tradeRecordBase.extend({
    serviceType: z.literal("camera"),
    topology: z.array(z.object({
      name: z.string().trim().min(1).max(160),
      kind: z.enum(["camera", "nvr", "switch", "storage", "network", "other"]),
      location: optionalText(240),
    }).strict()).max(200).default([]),
  }).strict(),
  tradeRecordBase.extend({
    serviceType: z.literal("electrical"),
    circuits: z.array(z.object({
      code: z.string().trim().min(1).max(80),
      description: optionalText(240),
      breaker: optionalText(120),
      cable: optionalText(120),
      loadWatts: z.coerce.number().min(0).optional(),
    }).strict()).max(300).default([]),
    lotoReference: optionalText(240),
    singleLineDiagramUrl: z.union([z.string().trim().url(), z.literal("")]).optional().default(""),
  }).strict(),
  tradeRecordBase.extend({
    serviceType: z.literal("plumbing"),
    zones: z.array(z.object({
      name: z.string().trim().min(1).max(160),
      pipeSpec: optionalText(160),
      isolationPoint: optionalText(240),
      pressureBar: z.coerce.number().min(0).optional(),
      durationMinutes: z.coerce.number().int().min(0).optional(),
      pressureDropBar: z.coerce.number().min(0).optional(),
      passed: z.boolean().optional(),
    }).strict()).max(200).default([]),
    routePlanUrl: z.union([z.string().trim().url(), z.literal("")]).optional().default(""),
  }).strict(),
]);

export const serviceJobDependencySchema = z.object({
  projectId: z.uuid(),
  predecessorJobId: z.uuid(),
  successorJobId: z.uuid(),
  dependencyType: z.enum(["finish_to_start", "evidence_required", "handoff"]).default("finish_to_start"),
  status: z.enum(["pending", "ready", "blocked", "completed", "waived"]).default("pending"),
  note: optionalText(1000),
}).refine((value) => value.predecessorJobId !== value.successorJobId, {
  message: "services.errors.dependencySelf",
});

export const serviceCoordinationPointSchema = z.object({
  id: z.uuid().optional(),
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  locationLabel: optionalText(240),
  serviceTypes: z.array(concreteServiceTypeSchema).min(2).max(3),
  status: z.enum(["open", "ready", "blocked", "resolved", "waived"]).default("open"),
  description: optionalText(2000),
  assignedTo: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  isAcceptanceRequired: z.boolean().default(true),
});

export const serviceCoordinationUpdateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dependency"),
    id: z.uuid(),
    status: z.enum(["pending", "ready", "blocked", "completed", "waived"]),
    dependencyType: z.enum(["finish_to_start", "evidence_required", "handoff"]).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal("point"),
    id: z.uuid(),
    status: z.enum(["open", "ready", "blocked", "resolved", "waived"]),
    title: z.string().trim().min(1).max(240).optional(),
    locationLabel: z.string().trim().max(240).nullable().optional(),
    serviceTypes: z.array(concreteServiceTypeSchema).min(2).max(3).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    assignedTo: z.uuid().nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    isAcceptanceRequired: z.boolean().optional(),
  }).strict(),
]);

export const cameraVaultViewerSchema = z.object({
  profileId: z.uuid(),
  canReveal: z.boolean().default(true),
  canCopy: z.boolean().default(false),
  canRotate: z.boolean().default(false),
  canManageViewers: z.boolean().default(false),
});

export const cameraVaultViewerTargetSchema = z.object({
  profileId: z.uuid(),
});
