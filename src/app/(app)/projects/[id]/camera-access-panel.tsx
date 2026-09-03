"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clipboard, Eye, EyeOff, Globe2, History, LockKeyhole, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAppDataQuery } from "@/components/use-app-data-query";

type CameraAsset = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  locationLabel: string | null;
  cameraAccessConfigured: boolean | null;
  cameraAccessRotatedAt: Date | null;
};

type VaultCredentials = {
  username: string;
  password: string;
  verificationCode: string;
  encryptionKey: string;
  ddnsProvider: string;
  ddnsDomain: string;
  ddnsUsername: string;
  ddnsPassword: string;
  wanIp: string;
  httpPort: number | null;
  rtspPort: number | null;
  onvifPort: number | null;
  directUrl: string;
};

type VaultSummary = {
  configured: boolean;
  rotatedAt: string | null;
  connection?: {
    ddnsProvider: string | null;
    ddnsDomain: string | null;
    wanIp: string | null;
    httpPort: number | null;
    rtspPort: number | null;
    onvifPort: number | null;
    directUrl: string | null;
    hasUsername: boolean;
    hasPassword: boolean;
    hasVerificationCode: boolean;
    hasEncryptionKey: boolean;
  } | null;
  viewers: Array<{
    profileId: string;
    fullName: string;
    role: string;
    canReveal: boolean;
    canCopy: boolean;
    canRotate: boolean;
    canManageViewers: boolean;
  }>;
  eligibleViewers: Array<{
    profileId: string;
    fullName: string;
    role: string;
  }>;
  history: Array<{
    id: string;
    action: string;
    actorName: string | null;
    actorNameSnapshot: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  permissions: ViewerPermissions;
};

type ViewerPermissions = {
  canReveal: boolean;
  canCopy: boolean;
  canRotate: boolean;
  canManageViewers: boolean;
};

const defaultViewerPermissions: ViewerPermissions = {
  canReveal: true,
  canCopy: false,
  canRotate: false,
  canManageViewers: false,
};

const emptyCredentials: VaultCredentials = {
  username: "",
  password: "",
  verificationCode: "",
  encryptionKey: "",
  ddnsProvider: "",
  ddnsDomain: "",
  ddnsUsername: "",
  ddnsPassword: "",
  wanIp: "",
  httpPort: null,
  rtspPort: null,
  onvifPort: null,
  directUrl: "",
};

async function readApiPayload<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(response.status >= 500
      ? "Kho truy cập camera chưa sẵn sàng. Cần áp migration database mới."
      : "Máy chủ không trả về dữ liệu.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(response.status >= 500
      ? "Kho truy cập camera chưa sẵn sàng. Cần áp migration database mới."
      : "Phản hồi từ máy chủ không hợp lệ.");
  }
}

async function readVaultSummary(assetId: string, signal: AbortSignal): Promise<VaultSummary> {
  const response = await fetch(`/api/mobile/services/assets/${assetId}/camera-vault`, { cache: "no-store", signal });
  const payload = await readApiPayload<{ ok: boolean; data?: VaultSummary; error?: string }>(response);
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? "errors.serverError");
  return payload.data;
}

export function CameraAccessPanel({ assets }: { assets: CameraAsset[] }) {
  const router = useRouter();
  const t = useTranslations();
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? "");
  const [revealed, setRevealed] = useState<VaultCredentials | null>(null);
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VaultCredentials>(emptyCredentials);
  const [viewerId, setViewerId] = useState("");
  const [viewerPermissions, setViewerPermissions] = useState<ViewerPermissions>(defaultViewerPermissions);
  const [mutating, setBusy] = useState(false);
  const [mutationMessage, setMessage] = useState("");
  const selected = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? assets[0],
    [assets, selectedId],
  );
  const { state: summaryQuery, refresh: refreshSummary } = useAppDataQuery(selected?.id ?? null, readVaultSummary);
  const summary = summaryQuery?.data ?? null;
  const busy = mutating || Boolean(summaryQuery?.loading);
  const message = summaryQuery?.error ? t(summaryQuery.error as never) : mutationMessage;

  useEffect(() => {
    if (!revealed) return;
    const timeout = window.setTimeout(() => {
      setRevealed(null);
      setPin("");
      setMessage("Thông tin bí mật đã được tự động ẩn.");
    }, 30_000);
    return () => window.clearTimeout(timeout);
  }, [revealed]);

  async function loadSummary() { await refreshSummary(); }

  function selectAsset(assetId: string) {
    if (assetId === selected?.id) return;
    setRevealed(null);
    setEditing(false);
    setPin("");
    setSelectedId(assetId);
  }

  async function approvalToken(assetId: string) {
    if (!/^\d{4,6}$/.test(pin)) throw new Error("Nhập PIN 4–6 số để xác thực lại.");
    const response = await fetch("/api/mobile/auth/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        permission: "service.credentials",
        scope: `services:camera-vault:${assetId}`,
        pin,
        reason: "Truy cập kho thông tin camera/NVR",
      }),
    });
    const payload = await readApiPayload<{ ok: boolean; data?: { token: string }; error?: string }>(response);
    if (!response.ok || !payload.ok || !payload.data?.token) throw new Error(payload.error ?? "Xác thực không thành công");
    return payload.data.token;
  }

  async function reveal(intent: "reveal" | "copy" = "reveal", field?: keyof VaultCredentials) {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await approvalToken(selected.id);
      const response = await fetch(`/api/mobile/services/assets/${selected.id}/camera-vault`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-luma-approval-token": token,
        },
        cache: "no-store",
        body: JSON.stringify({ intent }),
      });
      const payload = await readApiPayload<{
        ok: boolean;
        data?: { credentials: VaultCredentials };
        error?: string;
      }>(response);
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? "Không thể mở kho bí mật");
      if (intent === "copy" && field) {
        await navigator.clipboard.writeText(String(payload.data.credentials[field] ?? ""));
        setMessage("Đã sao chép và ghi vào lịch sử truy cập.");
      } else {
        setRevealed(payload.data.credentials);
        setMessage("Đã xác thực. Thông tin sẽ tự ẩn sau 30 giây.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể mở kho bí mật");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await approvalToken(selected.id);
      const response = await fetch(`/api/mobile/services/assets/${selected.id}/camera-vault`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-luma-approval-token": token,
        },
        body: JSON.stringify(draft),
      });
      const payload = await readApiPayload<{ ok: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Không lưu được cấu hình");
      setDraft(emptyCredentials);
      setEditing(false);
      setPin("");
      setRevealed(null);
      setMessage("Đã lưu cấu hình mã hóa và ghi lịch sử thay đổi.");
      await loadSummary();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được cấu hình");
    } finally {
      setBusy(false);
    }
  }

  function pickViewer(profileId: string) {
    setViewerId(profileId);
    const existing = summary?.viewers.find((viewer) => viewer.profileId === profileId);
    setViewerPermissions(existing ? {
      canReveal: existing.canReveal,
      canCopy: existing.canCopy,
      canRotate: existing.canRotate,
      canManageViewers: existing.canManageViewers,
    } : defaultViewerPermissions);
  }

  function toggleViewerPermission(key: keyof ViewerPermissions) {
    setViewerPermissions((current) => {
      const next = { ...current, [key]: !current[key] };
      if (key !== "canReveal" && next[key]) next.canReveal = true;
      if (key === "canReveal" && !next.canReveal) {
        next.canCopy = false;
        next.canRotate = false;
        next.canManageViewers = false;
      }
      return next;
    });
  }

  async function updateViewer(method: "PATCH" | "DELETE") {
    if (!selected || !viewerId) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await approvalToken(selected.id);
      const response = await fetch(`/api/mobile/services/assets/${selected.id}/camera-vault`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-luma-approval-token": token,
        },
        body: JSON.stringify(method === "DELETE"
          ? { profileId: viewerId }
          : { profileId: viewerId, ...viewerPermissions }),
      });
      const payload = await readApiPayload<{ ok: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Không cập nhật được quyền truy cập");
      setMessage(method === "DELETE" ? "Đã thu hồi quyền và ghi lịch sử." : "Đã cập nhật quyền và ghi lịch sử.");
      await loadSummary();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không cập nhật được quyền truy cập");
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) {
    return <EmptyCameraState />;
  }

  return (
    <div className="grid min-h-[520px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <div>
            <p className="font-semibold">Danh sách thiết bị</p>
            <p className="text-xs text-slate-500">{assets.length} thiết bị Camera/NVR</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-primary-600" />
        </div>
        <div className="p-2">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => selectAsset(asset.id)}
              className={cn(
                "mb-1 flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                selected?.id === asset.id
                  ? "border-primary-300 bg-primary-50 text-primary-900"
                  : "border-transparent hover:bg-surface-2",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary-700">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{asset.name}</span>
                <span className="block truncate text-xs text-slate-500">{asset.locationLabel ?? ([asset.brand, asset.model].filter(Boolean).join(" ") || "Chưa có vị trí")}</span>
              </span>
              {asset.cameraAccessConfigured && <CheckCircle2 className="h-4 w-4 text-ok" />}
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
            <div data-camera-vault-section="connection" className="flex min-w-0 items-center gap-2.5">
              <Globe2 className="h-5 w-5 shrink-0 text-primary-700" />
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{selected?.name}</h3>
                <p className="text-xs text-slate-500">Truy cập an toàn · không lưu bí mật khi ngoại tuyến</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => selected && loadSummary()} disabled={busy}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              Làm mới
            </Button>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <ConnectionCard label="DDNS" value={summary?.connection?.ddnsDomain ?? "Chưa cấu hình"} hint={summary?.connection?.ddnsProvider ?? undefined} />
            <ConnectionCard label="WAN IP" value={summary?.connection?.wanIp ?? "Chưa cấu hình"} />
            <ConnectionCard label="Cổng dịch vụ" value={[
              summary?.connection?.httpPort && `HTTP ${summary.connection.httpPort}`,
              summary?.connection?.rtspPort && `RTSP ${summary.connection.rtspPort}`,
              summary?.connection?.onvifPort && `ONVIF ${summary.connection.onvifPort}`,
            ].filter(Boolean).join(" · ") || "Chưa cấu hình"} />
            <ConnectionCard label="URL xem trực tiếp" value={summary?.connection?.directUrl ?? "Chưa cấu hình"} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div data-camera-vault-section="secrets" className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4" /> Thông tin bí mật</div>
              <p className="mt-1 text-xs text-slate-500">Cần PIN của chính bạn để xem, sao chép hoặc xoay mật khẩu.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevealed(null)} disabled={!revealed}>
                <EyeOff className="h-4 w-4" /> Ẩn
              </Button>
              <Button size="sm" onClick={() => void reveal()} disabled={busy || !summary?.configured || !summary.permissions.canReveal}>
                <Eye className="h-4 w-4" /> Xác thực để xem
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing((value) => !value)} disabled={Boolean(summary?.configured) && !summary?.permissions.canRotate}>
                <RefreshCw className="h-4 w-4" /> {summary?.configured ? "Xoay / cập nhật" : "Thiết lập"}
              </Button>
            </div>
          </div>
          <div className="mb-4 max-w-xs">
            <label className="mb-1 block text-xs font-semibold text-slate-600">PIN xác thực lại</label>
            <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SecretRow label="Tài khoản" value={revealed?.username} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "username")} />
            <SecretRow label="Mật khẩu" value={revealed?.password} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "password")} />
            <SecretRow label="Mã xác minh" value={revealed?.verificationCode} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "verificationCode")} />
            <SecretRow label="Encryption key" value={revealed?.encryptionKey} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "encryptionKey")} />
            <SecretRow label="Tài khoản DDNS" value={revealed?.ddnsUsername} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "ddnsUsername")} />
            <SecretRow label="Mật khẩu DDNS" value={revealed?.ddnsPassword} canCopy={Boolean(summary?.permissions.canCopy)} onCopy={() => void reveal("copy", "ddnsPassword")} />
          </div>
          {message && <p role="status" className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-slate-600">{message}</p>}
        </section>

        {editing && (
          <VaultEditor draft={draft} onChange={setDraft} onSave={() => void save()} busy={busy} />
        )}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 data-camera-vault-section="viewers" className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary-700" /> Người được xem</h3>
              <span className="text-xs text-slate-500">{summary?.viewers.length ?? 0} người</span>
            </div>
            <div className="space-y-2">
              {summary?.viewers.length ? summary.viewers.map((viewer) => (
                <div key={viewer.profileId} className="flex items-center justify-between gap-3 border-b border-border-soft pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{viewer.fullName}</p>
                    <p className="text-xs text-slate-500">{viewer.role === "owner" ? "Chủ cửa hàng" : "Quản lý"}</p>
                  </div>
                  <p className="text-xs font-medium text-primary-700">{viewer.canManageViewers ? "Toàn quyền" : viewer.canCopy ? "Xem & sao chép" : "Chỉ xem"}</p>
                </div>
              )) : <p className="text-sm text-slate-500">Chưa cấp quyền cho người xem.</p>}
            </div>
            {summary?.permissions.canManageViewers && summary.configured && (
              <div className="mt-4 space-y-3 border-t border-border-soft pt-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Chọn chủ cửa hàng / quản lý</span>
                  <Select
                    value={viewerId}
                    onValueChange={pickViewer}
                    options={summary.eligibleViewers.map((viewer) => ({
                      value: viewer.profileId,
                      label: `${viewer.fullName} · ${viewer.role === "owner" ? "Chủ cửa hàng" : "Quản lý"}`,
                    }))}
                    placeholder="Chọn người được xem"
                    rootClassName="w-full"
                    searchable
                    searchPlaceholder="Tìm theo tên"
                  />
                </label>
                {viewerId && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["canReveal", "Xem bí mật"],
                        ["canCopy", "Sao chép"],
                        ["canRotate", "Xoay mật khẩu"],
                        ["canManageViewers", "Quản lý quyền"],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={viewerPermissions[key]}
                          onClick={() => toggleViewerPermission(key)}
                          className={cn(
                            "min-h-11 min-w-11 rounded-lg border px-3 py-2 text-left text-xs font-semibold",
                            viewerPermissions[key]
                              ? "border-primary-300 bg-primary-50 text-primary-700"
                              : "border-border text-slate-500 hover:bg-surface-2",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {summary.viewers.some((viewer) => viewer.profileId === viewerId) && (
                        <Button variant="outline" size="sm" onClick={() => void updateViewer("DELETE")} disabled={busy}>
                          <Trash2 className="h-4 w-4" /> Thu hồi
                        </Button>
                      )}
                      <Button size="sm" onClick={() => void updateViewer("PATCH")} disabled={busy}>
                        <UserPlus className="h-4 w-4" /> Lưu quyền
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 data-camera-vault-section="history" className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary-700" /> Lịch sử truy cập</h3>
            <p className="mt-2 text-sm text-slate-500">Mọi lần xem, sao chép, đổi quyền và xoay mật khẩu đều được ghi vào nhật ký kiểm toán mà không chứa giá trị bí mật.</p>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {summary?.history.length ? summary.history.map((event) => (
                <div key={event.id} className="flex items-start justify-between gap-3 border-b border-border-soft pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{cameraAuditLabel(event.action)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{event.actorName ?? event.actorNameSnapshot ?? "Hệ thống"}</p>
                  </div>
                  <time className="shrink-0 text-xs text-slate-500">{new Date(event.createdAt).toLocaleString("vi-VN")}</time>
                </div>
              )) : <p className="text-sm text-slate-500">Chưa có sự kiện truy cập.</p>}
            </div>
            <p className="mt-3 text-xs text-slate-500">Xoay gần nhất: {summary?.rotatedAt ? new Date(summary.rotatedAt).toLocaleString("vi-VN") : "Chưa có"}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnectionCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border border-border-soft bg-surface-2 px-3 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-all text-sm font-semibold">{value}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

function cameraAuditLabel(action: string) {
  return action.endsWith(".reveal") ? "Đã xem thông tin bí mật"
    : action.endsWith(".copy") ? "Đã sao chép thông tin"
      : action.endsWith(".rotated") ? "Đã xoay mật khẩu"
        : action.endsWith(".viewer_updated") ? "Đã cập nhật quyền xem"
          : action.endsWith(".viewer_revoked") ? "Đã thu hồi quyền xem"
            : "Đã cập nhật cấu hình truy cập";
}

function SecretRow({ label, value, canCopy, onCopy }: { label: string; value?: string; canCopy: boolean; onCopy: () => void }) {
  const visible = Boolean(value);
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-border-soft px-3 py-2">
      <div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{label}</p><p className="truncate font-mono text-sm">{value || "••••••••••••"}</p></div>
      <span
        aria-hidden="true"
        data-camera-secret-visibility={visible ? "visible" : "hidden"}
        className="grid h-8 w-8 shrink-0 place-items-center text-slate-400"
      >
        {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </span>
      <button type="button" aria-label={`Sao chép ${label}`} onClick={onCopy} disabled={!value || !canCopy} className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 disabled:opacity-30"><Clipboard className="h-4 w-4" /></button>
    </div>
  );
}

function VaultEditor({ draft, onChange, onSave, busy }: { draft: VaultCredentials; onChange: (value: VaultCredentials) => void; onSave: () => void; busy: boolean }) {
  const fields: Array<{ key: keyof VaultCredentials; label: string; type?: string }> = [
    { key: "username", label: "Tài khoản Camera/NVR" },
    { key: "password", label: "Mật khẩu Camera/NVR", type: "password" },
    { key: "verificationCode", label: "Mã xác minh", type: "password" },
    { key: "encryptionKey", label: "Encryption key", type: "password" },
    { key: "ddnsProvider", label: "Nhà cung cấp DDNS" },
    { key: "ddnsDomain", label: "Tên miền DDNS" },
    { key: "ddnsUsername", label: "Tài khoản DDNS" },
    { key: "ddnsPassword", label: "Mật khẩu DDNS", type: "password" },
    { key: "wanIp", label: "WAN IP" },
    { key: "httpPort", label: "HTTP port", type: "number" },
    { key: "rtspPort", label: "RTSP port", type: "number" },
    { key: "onvifPort", label: "ONVIF port", type: "number" },
    { key: "directUrl", label: "URL xem trực tiếp" },
  ];
  return (
    <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
      <h3 className="font-semibold">Thiết lập / xoay thông tin truy cập</h3>
      <p className="mt-1 text-xs text-slate-500">Để trống trường không sử dụng. Khi cập nhật, nhập lại toàn bộ bộ thông tin cần giữ.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className={field.key === "directUrl" ? "md:col-span-2" : ""}>
            <span className="mb-1 block text-xs font-semibold text-slate-600">{field.label}</span>
            <Input
              type={field.type ?? "text"}
              autoComplete="off"
              value={draft[field.key] ?? ""}
              onChange={(event) => onChange({
                ...draft,
                [field.key]: field.type === "number"
                  ? (event.target.value ? Number(event.target.value) : null)
                  : event.target.value,
              })}
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={onSave} disabled={busy}><ShieldCheck className="h-4 w-4" /> Lưu mã hóa</Button></div>
    </section>
  );
}

function EmptyCameraState() {
  return <div className="rounded-xl border border-dashed border-border p-10 text-center"><LockKeyhole className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-semibold">Chưa có thiết bị Camera/NVR</p><p className="mt-1 text-sm text-slate-500">Ghi nhận thiết bị trong lệnh việc Camera để cấu hình truy cập an toàn.</p></div>;
}
