import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthConfigError, getAuthConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  let configurationUnavailable = false;
  try { getAuthConfig(); }
  catch (error) {
    if (!(error instanceof AuthConfigError)) throw error;
    configurationUnavailable = true;
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6">
      {configurationUnavailable && (
        <p role="status" className="w-full max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Login is unavailable. Please check the server authentication configuration.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
