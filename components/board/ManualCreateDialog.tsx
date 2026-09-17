"use client";

import { useRef, useState, type FormEvent } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import { createManualObjectAction } from "@/lib/actions/object-actions";
import { manualCreateObjectSchema } from "@/lib/validation/manual-edit";
import { COLUMNS, type ManagedObject } from "@/lib/types/object";

export function ManualCreateDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (object: ManagedObject) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const parsed = manualCreateObjectSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      setError("请填写对象名称，并检查内容是否超出长度限制。");
      return;
    }
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const object = await createManualObjectAction(parsed.data);
      onCreated(object);
    } catch {
      setError("无法保存对象，请检查连接和登录状态后重试。填写的内容已保留。");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
  return <WorkspaceDialog label="手动添加对象" busy={pending} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
      <h2 className="text-base font-semibold">手动添加对象</h2>
      <p className="text-sm text-slate-500">只需填写名称即可开始，其他信息和清单可以稍后补充。</p>
      <fieldset disabled={pending} className="space-y-4">
        <label className="block space-y-1 text-sm font-medium">对象名称 *
          <input autoFocus required name="title" maxLength={120} placeholder="例如：制作一张书桌" className={inputClass} />
        </label>
        <label className="block space-y-1 text-sm font-medium">状态
          <select name="status" defaultValue="idea" className={inputClass}>
            {COLUMNS.map((column) => <option key={column.id} value={column.id}>{column.emoji} {column.label}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">目标（可选）
          <textarea name="goal" maxLength={1000} rows={2} placeholder="最终想实现什么？" className={inputClass} />
        </label>
        <label className="block space-y-1 text-sm font-medium">当前进展（可选）
          <textarea name="currentState" maxLength={1000} rows={2} placeholder="已经实际完成了什么？" className={inputClass} />
        </label>
        <label className="block space-y-1 text-sm font-medium">下一步（可选）
          <textarea name="nextAction" maxLength={500} rows={2} placeholder="接下来可以立即开始的具体行动" className={inputClass} />
        </label>
      </fieldset>
      {error && <p role="alert" className="error-note">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} className="btn-secondary" onClick={onClose}>取消</button>
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "正在保存…" : "创建对象"}</button>
      </div>
    </form>
  </WorkspaceDialog>;
}
