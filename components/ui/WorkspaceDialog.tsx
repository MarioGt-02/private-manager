"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Native modal supplies focus containment, inert background and focus restoration. */
export function WorkspaceDialog({ children, label, onClose, busy = false, compact = false, closeOnBackdrop = true }: {
  children: ReactNode; label: string; onClose: () => void; busy?: boolean; compact?: boolean; closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-label={label} aria-busy={busy} className="workspace-dialog" data-compact={compact || undefined}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (!closeOnBackdrop || event.target !== event.currentTarget || busy) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>{children}</dialog>;
}
