import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  auditLogs,
  installedAssets,
  profiles,
  projects,
  serviceCameraVaults,
  serviceCameraVaultViewers,
  serviceJobs,
} from "@/db/schema";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  cameraVaultMaskedSummary,
  decryptCameraVault,
  encryptCameraVault,
} from "@/lib/services/camera-vault";
import {
  cameraVaultPayloadSchema,
  cameraVaultViewerSchema,
  cameraVaultViewerTargetSchema,
} from "@/lib/services/project-specialized-schemas";

type RouteContext = { params: Promise<{ assetId: string }> };

async function loadCameraAsset(storeId: string, assetId: string) {
  const [asset] = await db.select({
    id: installedAssets.id,
    name: installedAssets.name,
    assetKind: installedAssets.assetKind,
    projectId: installedAssets.projectId,
    projectServiceType: projects.serviceType,
    jobServiceType: serviceJobs.serviceType,
  }).from(installedAssets)
    .innerJoin(projects, eq(installedAssets.projectId, projects.id))
    .leftJoin(serviceJobs, eq(installedAssets.jobId, serviceJobs.id))
    .where(and(
      eq(installedAssets.storeId, storeId),
      eq(projects.storeId, storeId),
      eq(installedAssets.id, assetId),
    ))
    .limit(1);
  if (!asset) return null;
  const cameraKind = /camera|nvr|dvr|đầu ghi|dau ghi/i.test(asset.assetKind);
  const belongsToCamera = asset.projectServiceType === "camera"
    || asset.jobServiceType === "camera"
    || (asset.projectServiceType === "mixed" && cameraKind);
  return belongsToCamera ? asset : null;
}

async function loadVault(storeId: string, assetId: string) {
  const [vault] = await db.select().from(serviceCameraVaults).where(and(
    eq(serviceCameraVaults.storeId, storeId),
    eq(serviceCameraVaults.assetId, assetId),
  )).limit(1);
  return vault ?? null;
}

async function viewerGrant(vaultId: string, storeId: string, profileId: string) {
  const [grant] = await db.select().from(serviceCameraVaultViewers).where(and(
    eq(serviceCameraVaultViewers.storeId, storeId),
    eq(serviceCameraVaultViewers.vaultId, vaultId),
    eq(serviceCameraVaultViewers.profileId, profileId),
  )).limit(1);
  return grant ?? null;
}

async function eligibleViewers(storeId: string) {
  return db.select({
    profileId: profiles.id,
    fullName: profiles.fullName,
    role: profiles.role,
  }).from(profiles).where(and(
    eq(profiles.storeId, storeId),
    eq(profiles.isActive, true),
    inArray(profiles.role, ["owner", "manager"]),
  )).orderBy(asc(profiles.fullName));
}

function approvalScope(assetId: string) {
  return `services:camera-vault:${assetId}`;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { assetId } = await params;
  const asset = await loadCameraAsset(gate.storeId, assetId);
  if (!asset) return mobileError("errors.notFound", 404);
  const vault = await loadVault(gate.storeId, assetId);
  const availableViewers = await eligibleViewers(gate.storeId);
  if (!vault) {
    return mobileOk({
      assetId,
      assetName: asset.name,
      configured: false,
      rotatedAt: null,
      viewers: [],
      history: [],
      eligibleViewers: availableViewers,
      permissions: {
        canReveal: true,
        canCopy: true,
        canRotate: true,
        canManageViewers: true,
      },
    });
  }
  let connectionSummary = null;
  try {
    connectionSummary = cameraVaultMaskedSummary(decryptCameraVault(vault, {
      storeId: gate.storeId,
      assetId,
    }));
  } catch {
    return mobileError("errors.serverError", 500);
  }
  const [viewers, currentGrant, history] = await Promise.all([db.select({
    profileId: serviceCameraVaultViewers.profileId,
    fullName: profiles.fullName,
    role: profiles.role,
    canReveal: serviceCameraVaultViewers.canReveal,
    canCopy: serviceCameraVaultViewers.canCopy,
    canRotate: serviceCameraVaultViewers.canRotate,
    canManageViewers: serviceCameraVaultViewers.canManageViewers,
  }).from(serviceCameraVaultViewers)
    .innerJoin(profiles, eq(serviceCameraVaultViewers.profileId, profiles.id))
    .where(and(
      eq(serviceCameraVaultViewers.storeId, gate.storeId),
      eq(serviceCameraVaultViewers.vaultId, vault.id),
    )), viewerGrant(vault.id, gate.storeId, gate.userId), db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorName: profiles.fullName,
      actorNameSnapshot: auditLogs.actorNameSnapshot,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .leftJoin(profiles, eq(auditLogs.actorId, profiles.id))
      .where(and(
        eq(auditLogs.storeId, gate.storeId),
        eq(auditLogs.entityType, "service_camera_vault"),
        eq(auditLogs.entityId, vault.id),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50)]);
  const owner = gate.role === "owner";
  return mobileOk({
    id: vault.id,
    assetId,
    assetName: asset.name,
    configured: vault.configured,
    keyVersion: vault.keyVersion,
    rotatedAt: vault.rotatedAt,
    updatedAt: vault.updatedAt,
    connection: connectionSummary,
    viewers,
    history,
    eligibleViewers: availableViewers,
    permissions: {
      canReveal: owner || Boolean(currentGrant?.canReveal),
      canCopy: owner || Boolean(currentGrant?.canCopy),
      canRotate: owner || Boolean(currentGrant?.canRotate),
      canManageViewers: owner || Boolean(currentGrant?.canManageViewers),
    },
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { assetId } = await params;
  const asset = await loadCameraAsset(gate.storeId, assetId);
  if (!asset) return mobileError("errors.notFound", 404);
  const parsed = cameraVaultPayloadSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const existing = await loadVault(gate.storeId, assetId);
  if (existing && gate.role !== "owner") {
    const grant = await viewerGrant(existing.id, gate.storeId, gate.userId);
    if (!grant?.canRotate) return mobileError("errors.forbidden", 403);
  }
  const authorized = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "service.credentials",
    scope: approvalScope(assetId),
  });
  if (!authorized.ok) return mobileError(authorized.error, 403);

  let previousPassword = "";
  let previousDdnsPassword = "";
  if (existing) {
    const previous = decryptCameraVault(existing, {
      storeId: gate.storeId,
      assetId,
    });
    previousPassword = previous.password;
    previousDdnsPassword = previous.ddnsPassword;
  }
  const rotated = Boolean(existing) && (
    previousPassword !== parsed.data.password
    || previousDdnsPassword !== parsed.data.ddnsPassword
  );
  const encrypted = encryptCameraVault(parsed.data, {
    storeId: gate.storeId,
    assetId,
    keyVersion: existing?.keyVersion ?? 1,
  });
  const summary = cameraVaultMaskedSummary(parsed.data);
  const now = new Date();
  const [vault] = await db.transaction(async (tx) => {
    const [saved] = await tx.insert(serviceCameraVaults).values({
      storeId: gate.storeId,
      projectId: asset.projectId,
      assetId,
      ...encrypted,
      configured: summary.configured,
      rotatedAt: rotated ? now : existing?.rotatedAt ?? null,
      rotatedBy: rotated ? gate.userId : existing?.rotatedBy ?? null,
      createdBy: gate.userId,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: serviceCameraVaults.assetId,
      set: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        configured: summary.configured,
        rotatedAt: rotated ? now : existing?.rotatedAt ?? null,
        rotatedBy: rotated ? gate.userId : existing?.rotatedBy ?? null,
        updatedAt: now,
      },
    }).returning();
    await tx.insert(serviceCameraVaultViewers).values({
      storeId: gate.storeId,
      vaultId: saved.id,
      profileId: gate.userId,
      canReveal: true,
      canCopy: true,
      canRotate: true,
      canManageViewers: true,
      grantedBy: gate.userId,
    }).onConflictDoUpdate({
      target: [serviceCameraVaultViewers.vaultId, serviceCameraVaultViewers.profileId],
      set: {
        canReveal: true,
        canCopy: true,
        canRotate: true,
        canManageViewers: true,
        updatedAt: now,
      },
    });
    return [saved];
  });
  await db.insert(auditLogs).values({
    storeId: gate.storeId,
    actorId: gate.userId,
    source: "mobile",
    action: rotated ? "service.camera_vault.rotated" : "service.camera_vault.updated",
    entityType: "service_camera_vault",
    entityId: vault.id,
    status: "succeeded",
    metadata: {
      projectId: asset.projectId,
      assetId,
      changedFields: Object.entries(parsed.data)
        .filter(([, value]) => value !== "" && value !== null)
        .map(([key]) => key),
    },
  });
  return mobileOk({
    id: vault.id,
    assetId,
    ...summary,
    rotatedAt: vault.rotatedAt,
    updatedAt: vault.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { assetId } = await params;
  const vault = await loadVault(gate.storeId, assetId);
  if (!vault) return mobileError("errors.notFound", 404);
  if (gate.role !== "owner") {
    const grant = await viewerGrant(vault.id, gate.storeId, gate.userId);
    if (!grant?.canManageViewers) return mobileError("errors.forbidden", 403);
  }
  const parsed = cameraVaultViewerSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const authorized = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "service.credentials",
    scope: approvalScope(assetId),
  });
  if (!authorized.ok) return mobileError(authorized.error, 403);
  const [target] = await db.select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.storeId, gate.storeId),
      eq(profiles.id, parsed.data.profileId),
      eq(profiles.isActive, true),
    )).limit(1);
  if (!target || !["owner", "manager"].includes(target.role)) {
    return mobileError("errors.invalidData");
  }
  await db.insert(serviceCameraVaultViewers).values({
    storeId: gate.storeId,
    vaultId: vault.id,
    ...parsed.data,
    grantedBy: gate.userId,
  }).onConflictDoUpdate({
    target: [serviceCameraVaultViewers.vaultId, serviceCameraVaultViewers.profileId],
    set: {
      canReveal: parsed.data.canReveal,
      canCopy: parsed.data.canCopy,
      canRotate: parsed.data.canRotate,
      canManageViewers: parsed.data.canManageViewers,
      grantedBy: gate.userId,
      updatedAt: new Date(),
    },
  });
  await db.insert(auditLogs).values({
    storeId: gate.storeId,
    actorId: gate.userId,
    source: "mobile",
    action: "service.camera_vault.viewer_updated",
    entityType: "service_camera_vault",
    entityId: vault.id,
    metadata: { assetId, ...parsed.data },
  });
  return mobileOk(parsed.data);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { assetId } = await params;
  const vault = await loadVault(gate.storeId, assetId);
  if (!vault) return mobileError("errors.notFound", 404);
  if (gate.role !== "owner") {
    const grant = await viewerGrant(vault.id, gate.storeId, gate.userId);
    if (!grant?.canManageViewers) return mobileError("errors.forbidden", 403);
  }
  const parsed = cameraVaultViewerTargetSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const authorized = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "service.credentials",
    scope: approvalScope(assetId),
  });
  if (!authorized.ok) return mobileError(authorized.error, 403);
  await db.delete(serviceCameraVaultViewers).where(and(
    eq(serviceCameraVaultViewers.storeId, gate.storeId),
    eq(serviceCameraVaultViewers.vaultId, vault.id),
    eq(serviceCameraVaultViewers.profileId, parsed.data.profileId),
  ));
  await db.insert(auditLogs).values({
    storeId: gate.storeId,
    actorId: gate.userId,
    source: "mobile",
    action: "service.camera_vault.viewer_revoked",
    entityType: "service_camera_vault",
    entityId: vault.id,
    metadata: { assetId, profileId: parsed.data.profileId },
  });
  return mobileOk({ profileId: parsed.data.profileId });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { assetId } = await params;
  const vault = await loadVault(gate.storeId, assetId);
  if (!vault) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  const intent = body && typeof body === "object" && "intent" in body && body.intent === "copy"
    ? "copy"
    : "reveal";
  const grant = gate.role === "owner"
    ? null
    : await viewerGrant(vault.id, gate.storeId, gate.userId);
  if (gate.role !== "owner" && !(intent === "copy" ? grant?.canCopy : grant?.canReveal)) {
    return mobileError("errors.forbidden", 403);
  }
  const authorized = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "service.credentials",
    scope: approvalScope(assetId),
  });
  if (!authorized.ok) return mobileError(authorized.error, 403);
  const credentials = decryptCameraVault(vault, {
    storeId: gate.storeId,
    assetId,
  });
  await db.insert(auditLogs).values({
    storeId: gate.storeId,
    actorId: gate.userId,
    source: "mobile",
    action: `service.camera_vault.${intent}`,
    entityType: "service_camera_vault",
    entityId: vault.id,
    metadata: { assetId },
  });
  return NextResponse.json(
    { ok: true, data: { credentials, expiresInSeconds: 30 } },
    { headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" } },
  );
}
