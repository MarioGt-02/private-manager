"use client";

import { useRef, useState } from "react";
import { WorkspaceDialog } from "@/components/ui/WorkspaceDialog";
import type {
  AIConversationMessage,
  CreateObjectDraft,
} from "@/lib/ai/types";
import type { ManagedObject } from "@/lib/types/object";
import type { CategoryOption } from "@/lib/categories/suggestion";
import { AICreateConversation } from "./AICreateConversation";
import { ObjectDraftPreview } from "./ObjectDraftPreview";
import { mergeChatDraft } from "@/lib/ai/draft";
import { ErrorDetails } from "@/components/ui/ErrorDetails";
import { localError, parseErrorDetail } from "@/lib/errors/client";
import type { ErrorDetail } from "@/lib/errors/types";

interface AICreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (object: ManagedObject) => void;
}

export function AICreateDialog({
  open,
  onClose,
  onCreated,
}: AICreateDialogProps) {
  const [messages, setMessages] = useState<AIConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState<CreateObjectDraft | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [phase, setPhase] = useState<"conversation" | "proposal">("conversation");
  const [isSending, setIsSending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);

  const requestLock = useRef(false);
  if (!open) return null;

  function reset() {
    setInput("");
    setConfirmReset(false);
    setMessages([]);
    setDraft(null);
    setCategories([]);
    setPhase("conversation");
    setError(null);
  }

  function close() {
    if (requestLock.current) return;
    setConfirmReset(false);
    onClose();
  }

  async function sendMessage(text: string): Promise<boolean> {
    if (requestLock.current) return false;
    requestLock.current = true;
    const userMessage: AIConversationMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/create-object/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, currentDraft: draft }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(parseErrorDetail(data, "Could not send your message. Please try again."));
        setMessages(messages);
        return false;
      }

      setCategories(data.categories ?? []);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.message },
      ]);

      if (data.phase === "proposal" && data.draft) {
        setDraft(data.draft);
        setPhase("proposal");
      } else {
        setPhase("conversation");
        // Preserve the partial draft across clarifying turns (recurrence basis/date).
        setDraft((prev) => mergeChatDraft(prev, data.draft ?? null));
      }
    } catch {
      setError(localError("Could not reach AI. Your conversation and draft are still here."));
      setMessages(messages);
      return false;
    } finally {
      requestLock.current = false;
      setIsSending(false);
    }
    return true;
  }

  async function createObject() {
    if (!draft || requestLock.current) return;
    requestLock.current = true;
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/create-object/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(parseErrorDetail(data, "Could not create the object."));
        return;
      }

      onCreated(data.object);
      reset();
    } catch {
      setError(localError("Could not create the object. Please try again."));
    } finally {
      requestLock.current = false;
      setIsCreating(false);
    }
  }

  return (
    <WorkspaceDialog label="AI Create" onClose={close} busy={isSending || isCreating}>
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">✨ AI Create</h2>
          <button type="button" className="btn-secondary ml-auto mr-2" disabled={isSending || isCreating} onClick={() => { if (messages.length || draft || input) setConfirmReset(true); else reset(); }}>新对话</button>
          <button
            type="button"
            disabled={isSending || isCreating}
            autoFocus
            onClick={close}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
          {confirmReset && <div className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p>开始新对话会清除当前对话、草稿和未发送文字。</p>
            <div className="flex gap-2">
              <button type="button" className="btn-danger" disabled={isSending || isCreating} onClick={reset}>清空并开始</button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmReset(false)}>保留对话</button>
            </div>
          </div>}
          {error && <ErrorDetails detail={error} onDismiss={() => setError(null)} className="mb-4" />}

          {phase === "proposal" && draft ? (
            <ObjectDraftPreview
              categories={categories}
              draft={draft}
              isCreating={isCreating}
              onChange={setDraft}
              onKeepDiscussing={() => setPhase("conversation")}
              onCreate={createObject}
            />
          ) : (
            <AICreateConversation
              input={input}
              onInputChange={setInput}
              messages={messages}
              isSending={isSending}
              onSend={sendMessage}
            />
          )}
        </div>

    </WorkspaceDialog>
  );
}
