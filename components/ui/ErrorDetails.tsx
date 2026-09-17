"use client";

import { useState } from "react";
import { formatDebugReport } from "@/lib/errors/serialize";
import type { ErrorDetail } from "@/lib/errors/types";

interface ErrorDetailsProps {
  detail: ErrorDetail;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Reusable technical error panel. Shows the user-facing message and request ID,
 * plus (when the server included sanitized debug) an expandable technical panel
 * and a "Copy debug info" button. The copied report is sanitized.
 */
export function ErrorDetails({ detail, onDismiss, className }: ErrorDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDebug = Boolean(detail.debug && Object.keys(detail.debug).length > 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatDebugReport(detail));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{detail.message}</p>
          {detail.requestId && (
            <p className="mt-0.5 break-all text-xs text-red-500">
              Request ID: {detail.requestId}
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="text-red-400 transition-colors hover:text-red-600"
          >
            ×
          </button>
        )}
      </div>

      {hasDebug && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-700"
          >
            {expanded ? "Hide technical details" : "Show technical details"}
          </button>
          <button
            type="button"
            onClick={copy}
            className="text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-700"
          >
            {copied ? "Copied" : "Copy debug info"}
          </button>
        </div>
      )}

      {expanded && hasDebug && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 font-mono text-xs text-slate-700">
          {formatDebugReport(detail)}
        </pre>
      )}
    </div>
  );
}
