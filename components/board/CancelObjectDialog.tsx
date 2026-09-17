"use client";
import { useRef, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";

export function CancelObjectDialog({ object, onConfirm, onClose }: {
  object: { id: string; title: string }; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError("");
    try { await onConfirm(); onClose(); }
    catch { setError("取消失败，卡片尚未移除，请重试。"); }
    finally { lock.current = false; setPending(false); }
  }
  return <WorkspaceDialog compact label="确认取消对象" busy={pending} onClose={onClose}>
    <div className="space-y-4 p-5 sm:p-6">
      <h2 className="text-base font-semibold">取消这个对象？</h2>
      <p className="content-wrap text-sm font-medium text-slate-800">{object.title}</p>
      <p className="text-sm leading-6 text-slate-600">确认后会标记为已放弃，并存档到原来的状态列。卡片、清单和活动记录都会保留，之后可以恢复。</p>
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus className="btn-secondary" disabled={pending} onClick={onClose}>保留卡片</button>
        <button type="button" className="btn-danger border border-red-200" disabled={pending} onClick={() => void confirm()}>{pending ? "正在取消…" : "确认取消"}</button>
      </div>
    </div>
  </WorkspaceDialog>;
}
