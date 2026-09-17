"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      if (response.ok) { window.location.replace("/"); return; }
      const result = await response.json();
      setError(result.error?.message ?? "Could not log in. Please try again.");
    } catch { setError("Could not log in. Please try again."); }
    const password = form.elements.namedItem("password") as HTMLInputElement;
    password.value = "";
    setPending(false);
  }
  const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600";
  return <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
    <h1 className="text-xl font-semibold text-slate-900">Private Manager</h1>
    <label className="block text-sm font-medium text-slate-700">Username
      <input name="username" autoComplete="username" required maxLength={200} className={inputClass} />
    </label>
    <label className="block text-sm font-medium text-slate-700">Password
      <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
    </label>
    {error && <p role="alert" className="error-note">{error}</p>}
    <button disabled={pending} className="btn-primary w-full">
      {pending ? "Logging in…" : "Log in"}
    </button>
  </form>;
}
