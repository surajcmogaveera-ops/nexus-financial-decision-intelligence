import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 sm:px-8">
    <header className="flex h-20 items-center"><Brand /></header>
    <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1fr_.8fr]">
      <section className="max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Start with clarity</p>
        <h1 className="mt-4 text-4xl font-medium tracking-[-0.045em] text-[var(--ink)] sm:text-5xl">Build a more considered financial picture.</h1>
        <p className="mt-5 max-w-lg leading-7 text-[var(--muted)]">Create your account to access your private NEXUS workspace and keep your financial picture in one place.</p>
      </section>
      <section className="mx-auto w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-6 shadow-[0_18px_60px_-42px_rgba(18,39,32,.35)] sm:p-8" aria-labelledby="register-heading">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]" id="register-heading">Create your account</h2>
        <p className="mt-2 mb-7 text-sm text-[var(--muted)]">Set up secure access to NEXUS.</p>
        <AuthForm mode="register" />
      </section>
    </div>
  </main>;
}
