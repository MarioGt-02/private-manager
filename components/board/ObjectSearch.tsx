"use client";

import { forwardRef, useEffect, useRef } from "react";
import { shouldClearObjectSearch, shouldFocusObjectSearch } from "@/lib/objects/search";

export const ObjectSearch = forwardRef<HTMLInputElement, {
  value: string;
  resultCount?: number;
  onChange: (value: string) => void;
}>(({ value, resultCount, onChange }, forwardedRef) => {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = (node: HTMLInputElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!shouldFocusObjectSearch(event.key, event.target)) return;
      event.preventDefault();
      localRef.current?.focus();
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative flex min-w-[12rem] max-w-[21rem] flex-1 items-center sm:w-64 sm:flex-none">
        <span aria-hidden="true" className="pointer-events-none absolute left-2.5 text-slate-400">⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (shouldClearObjectSearch(event.key, value)) {
              event.preventDefault();
              event.stopPropagation();
              onChange("");
            }
          }}
          placeholder="Search objects..."
          aria-label="Search objects"
          className="input w-full py-1.5 pl-8 pr-8 text-sm"
        />
        {value && <button type="button" aria-label="Clear object search" title="Clear search" onClick={() => { onChange(""); localRef.current?.focus(); }} className="absolute right-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-500">×</button>}
      </div>
      {value.trim() && resultCount !== undefined && <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-slate-500">{resultCount} results</span>}
    </div>
  );
});
ObjectSearch.displayName = "ObjectSearch";