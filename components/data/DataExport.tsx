"use client";
import { useRef, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
export function DataExport() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function download(format: "json" | "csv") {
    if (lock.current) return; lock.current = true; setBusy(format); setError("");
    try {
      const response = await fetch(`/api/export/${format}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Export unavailable");
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `private-manager-${new Date().toISOString().slice(0,10)}.${format}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Could not export data. Please try again."); }
    finally { lock.current = false; setBusy(null); }
  }
  return <><button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Data / Export</button>
    {open && <WorkspaceDialog label="Export all data" busy={!!busy} onClose={() => setOpen(false)}>
      <header className="flex items-center justify-between border-b border-slate-200 p-5"><h2 className="font-semibold">Export all data</h2><button type="button" className="btn-secondary" autoFocus disabled={!!busy} onClick={() => setOpen(false)}>Close</button></header>
      <div className="space-y-5 p-5"><p className="text-sm leading-6 text-slate-600">Includes live, archived and cancelled Objects. JSON preserves checklist IDs, timestamps and Activity as a versioned backup. CSV is a readable Object summary.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={!!busy} onClick={() => void download("json")}>{busy === "json" ? "Exporting…" : "Export JSON"}</button><button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void download("csv")}>{busy === "csv" ? "Exporting…" : "Export CSV"}</button></div>
        {error && <p role="alert" className="error-note">{error}</p>}
      </div>
    </WorkspaceDialog>}
  </>;
}
