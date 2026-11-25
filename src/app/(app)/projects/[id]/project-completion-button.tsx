"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  completeServiceProjectManually,
  toggleProjectStatus,
} from "@/lib/actions/extras";

/** Complete / reopen a project with the same confirmations; shared by the button and the phone "…" menu. */
export function useProjectCompletion(projectId: string, completed: boolean) {
  const router = useRouter();
  const { alert, confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function act() {
    if (busy) return;
    if (!completed) {
      const accepted = await confirm({
        title: "Hoàn thành công trình?",
        description: "Công trình chỉ được hoàn thành khi các lệnh việc, điều phối bắt buộc và biên bản bàn giao đã đầy đủ.",
        confirmLabel: "Hoàn thành",
      });
      if (!accepted) return;
    }
    setBusy(true);
    const result = await toggleProjectStatus(projectId);
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    await alert({
      title: "Không thể cập nhật công trình",
      description: result.error === "services.errors.projectCloseBlocked"
        ? "Công trình chưa đủ điều kiện hoàn thành. Hãy hoàn tất lệnh việc, xử lý điều phối bắt buộc và ký biên bản bàn giao."
        : "Vui lòng thử lại. Nếu lỗi vẫn còn, hãy tải lại trang trước khi thao tác tiếp.",
      variant: "warning",
    });
  }

  async function completeManually() {
    if (busy) return;
    const accepted = await confirm({
      title: "Hoàn thành thủ công?",
      description: "Thao tác quản lý này sẽ bỏ qua điều kiện lệnh việc, điều phối và biên bản bàn giao. Hồ sơ hiện tại vẫn được giữ nguyên.",
      confirmLabel: "Hoàn thành thủ công",
      variant: "warning",
    });
    if (!accepted) return;
    setBusy(true);
    const result = await completeServiceProjectManually({ id: projectId });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    await alert({
      title: "Không thể hoàn thành thủ công",
      description: "Vui lòng thử lại. Nếu lỗi vẫn còn, hãy tải lại trang trước khi thao tác tiếp.",
      variant: "warning",
    });
  }

  return { busy, act, completeManually };
}

export function ProjectCompletionButton({
  projectId,
  completed,
  className,
}: {
  projectId: string;
  completed: boolean;
  className?: string;
}) {
  const { busy, act, completeManually } = useProjectCompletion(projectId, completed);

  return (
    <div className={cn("flex w-full flex-col gap-2 sm:w-auto", className)}>
      <Button
        type="button"
        variant={completed ? "outline" : "default"}
        onClick={() => void act()}
        disabled={busy}
        loading={busy}
        className="w-full sm:w-auto max-lg:h-[50px] max-lg:!rounded-[14px] max-lg:text-[17px]"
      >
        {completed ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {completed ? "Mở lại công trình" : "Đánh dấu hoàn thành"}
      </Button>
      {!completed && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void completeManually()}
          disabled={busy}
          className="w-full text-xs text-slate-500 sm:w-auto max-lg:h-11 max-lg:text-[15px] max-lg:text-ios-accent"
        >
          Hoàn thành thủ công (bỏ qua nghiệm thu)
        </Button>
      )}
    </div>
  );
}
