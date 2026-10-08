"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api/client";

type AuthFormProps = { mode: "login" | "register" };

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      if (isRegister) {
        await api.register({ name: String(form.get("name") || "").trim(), email, password });
      } else {
        await api.login({ email, password });
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        setError(cause.code === "API_UNAVAILABLE"
          ? cause.message
          : cause.status === 401
            ? "Those sign-in details could not be verified. Check them and try again."
            : cause.status === 409
              ? "An account already uses this email address. Sign in instead."
              : cause.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {isRegister && (
        <label className="block space-y-2 text-sm font-medium text-[var(--ink)]">
          Name <span className="text-[var(--muted)]">(optional)</span>
          <input autoComplete="name" className="form-input" name="name" maxLength={120} />
        </label>
      )}
      <label className="block space-y-2 text-sm font-medium text-[var(--ink)]">
        Email
        <input autoComplete="email" className="form-input" name="email" type="email" required maxLength={254} />
      </label>
      <label className="block space-y-2 text-sm font-medium text-[var(--ink)]">
        Password
        <input autoComplete={isRegister ? "new-password" : "current-password"} className="form-input" name="password" type="password" required minLength={isRegister ? 12 : 1} maxLength={72} />
        {isRegister && <span className="block text-xs font-normal text-[var(--muted)]">Use at least 12 characters.</span>}
      </label>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p>}
      <button className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-60" type="submit" disabled={busy}>
        {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-[var(--muted)]">
        {isRegister ? "Already have an account? " : "New to NEXUS? "}
        <Link className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline" href={isRegister ? "/login" : "/register"}>
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
