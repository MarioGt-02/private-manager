"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { AIConversationMessage } from "@/lib/ai/types";

export function AICreateConversation({ messages, isSending, onSend, input, onInputChange: setInput }: {
  input: string; onInputChange: (value: string) => void;
  messages: AIConversationMessage[]; isSending: boolean; onSend: (text: string) => Promise<boolean>;
}) {
  const end = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages, isSending]);
  const canSend = input.trim().length > 0 && !isSending;
  async function submit() {
    if (!canSend || sending.current) return;
    sending.current = true;
    try { if (await onSend(input.trim())) setInput(""); } finally { sending.current = false; }
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  }
  return <div className="flex min-h-0 flex-col gap-4">
    <div role="log" aria-label="AI Create conversation" aria-live="polite" className="flex max-h-[55dvh] min-h-24 flex-col gap-3 overflow-y-auto pr-1">
      {!messages.length && <p className="empty-note">Describe what you want to accomplish.</p>}
      {messages.map((message, index) => <div key={index} className={`content-wrap max-w-[92%] rounded-xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "self-end border border-blue-100 bg-blue-50 text-slate-800" : "self-start border border-slate-200 bg-white text-slate-700"}`}>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{message.role === "user" ? "You" : "AI"}</p>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>)}
      {isSending && <p role="status" className="text-sm text-slate-500">Thinking…</p>}
      <div ref={end} />
    </div>
    <form className="sticky bottom-0 space-y-2 border-t border-slate-200 bg-white pt-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="block text-xs font-medium text-slate-600">Your message
        <textarea className="input mt-1" rows={3} maxLength={4000} value={input} disabled={isSending} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="What would you like to accomplish?" />
      </label>
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={!canSend} className="btn-primary">{isSending ? "Sending…" : "Send"}</button></div>
    </form>
  </div>;
}
