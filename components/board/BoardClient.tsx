"use client";

import dynamic from "next/dynamic";
import type { ManagedObject } from "@/lib/types/object";

const Board = dynamic(() => import("./Board").then((module) => module.Board), {
  ssr: false,
  loading: () => (
    <main role="status" className="flex h-dvh items-center justify-center bg-slate-50 text-sm text-slate-500">
      Loading board…
    </main>
  ),
});

export function BoardClient(props: {
  initialObjects: ManagedObject[];
  initialError?: string | null;
}) {
  return <Board {...props} />;
}
