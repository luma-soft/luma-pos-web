"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Button } from "@/components/ui/button";
import {
  completeServiceProjectManually,
  toggleProjectStatus,
} from "@/lib/actions/extras";

export function ProjectCompletionButton({
  projectId,
  completed,
}: {
  projectId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const { alert, confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function act() {
    if (busy) return;
    if (!completed) {
      const accepted = await confirm({
        title: "Hoàn thành công trình?",
        description: "Đánh dấu hoàn thành ngay, không yêu cầu chữ ký hoặc hồ sơ nghiệm thu.",
        confirmLabel: "Hoàn thành",
      });
      if (!accepted) return;
    }
    setBusy(true);
    const result = completed
      ? await toggleProjectStatus(projectId)
      : await completeServiceProjectManually({ id: projectId });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    await alert({
      title: "Không thể cập nhật công trình",
      description: "Vui lòng thử lại. Nếu lỗi vẫn còn, hãy tải lại trang trước khi thao tác tiếp.",
      variant: "warning",
    });
  }

  return (
    <Button
      type="button"
      variant={completed ? "outline" : "default"}
      onClick={() => void act()}
      disabled={busy}
      loading={busy}
      className="w-full sm:w-auto"
    >
      {completed ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
      {completed ? "Mở lại công trình" : "Hoàn thành nhanh"}
    </Button>
  );
}
