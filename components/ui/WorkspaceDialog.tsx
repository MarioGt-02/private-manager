"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Native modal supplies focus containment, inert background and focus restoration. */
export function WorkspaceDialog({ children, label, onClose, busy = false, compact = false, closeOnBackdrop = true, size = "drawer" }: {
  children: ReactNode; label: string; onClose: () => void; busy?: boolean; compact?: boolean; closeOnBackdrop?: boolean; size?: "drawer" | "workspace";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  function isBackdrop(event: { clientX: number; clientY: number }) {
    const dialog = ref.current;
    if (!dialog) return false;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }
  return <dialog ref={ref} aria-label={label} aria-busy={busy} className="workspace-dialog" data-compact={compact || undefined} data-size={size === "workspace" ? "workspace" : undefined}
    onCancel={(event) => { event.preventDefault(); if (!busy && !ref.current?.querySelector("[data-popover]")) onClose(); }}
    onMouseDown={(event) => { downOnBackdrop.current = closeOnBackdrop && event.target === event.currentTarget && isBackdrop(event); }}
    onClick={(event) => {
      if (!closeOnBackdrop || busy) return;
      if (event.target !== event.currentTarget) return;
      if (!downOnBackdrop.current) return;
      if (!isBackdrop(event)) return;
      downOnBackdrop.current = false;
      onClose();
    }}>{children}</dialog>;
}
