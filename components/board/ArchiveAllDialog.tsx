"use client";
import { useRef, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";

export function ArchiveAllDialog({ count, onConfirm, onClose }: {
  count: number; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError("");
    try { await onConfirm(); onClose(); }
    catch { setError("存档失败，部分对象已恢复，请重试。"); }
    finally { lock.current = false; setPending(false); }
  }
  return <WorkspaceDialog compact label="归档全部已完成对象" busy={pending} onClose={onClose}>
    <div className="space-y-4 p-5 sm:p-6">
      <h2 className="text-base font-semibold">归档全部已完成对象？</h2>
      <p className="text-sm leading-6 text-slate-600">将把 ✅ Done 列中的 {count} 个对象全部归档。对象、清单和活动记录都会保留，之后可以在归档抽屉中恢复。</p>
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus className="btn-secondary" disabled={pending} onClick={onClose}>取消</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => void confirm()}>{pending ? "正在归档…" : `归档 ${count} 个对象`}</button>
      </div>
    </div>
  </WorkspaceDialog>;
}
