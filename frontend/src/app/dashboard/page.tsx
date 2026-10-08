"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoadingState, StatusPanel } from "@/components/status-panel";
import { api, ApiClientError, type SafeUser } from "@/lib/api/client";

type ProfileState = "loading" | "available" | "missing" | "error";

const futureSections = [
  { id: "decision-lab", index: "02", title: "Decision Lab", description: "Scenario exploration will appear here when available." },
  { id: "evidence", index: "03", title: "Evidence", description: "Source material and provenance will be shown alongside relevant decisions." },
  { id: "ai-explanation", index: "04", title: "AI explanation", description: "Explanations will remain separate from deterministic financial values." },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>("loading");
  const [pageError, setPageError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadWorkspace() {
      try {
        const session = await api.currentUser();
        if (!active) return;
        setUser(session.user);
        try {
          await api.financialTwin();
          if (active) setProfileState("available");
        } catch (error) {
          if (!active) return;
          if (error instanceof ApiClientError && error.code === "FINANCIAL_PROFILE_NOT_FOUND") {
            setProfileState("missing");
          } else {
            setProfileState("error");
            setPageError(messageFor(error));
          }
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiClientError && (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "UNAUTHORIZED")) {
          router.replace("/login");
          return;
        }
        setProfileState("error");
        setPageError(messageFor(error));
      }
    }
    void loadWorkspace();
    return () => { active = false; };
  }, [router, retryKey]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.logout();
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setPageError(messageFor(error));
      setSigningOut(false);
    }
  }

  function retry() {
    setProfileState("loading");
    setPageError(null);
    setRetryKey((value) => value + 1);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[rgba(245,247,243,.92)] backdrop-blur">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Brand compact />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Dashboard">
            <a className="rounded-md px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" href="#financial-twin">Financial Twin</a>
            {futureSections.map((section) => <a className="rounded-md px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" href={`#${section.id}`} key={section.id}>{section.title}</a>)}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-44 truncate text-xs text-[var(--muted)] sm:inline" title={user?.email}>{user?.name || user?.email || "Checking session"}</span>
            <button className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60" type="button" onClick={signOut} disabled={signingOut || !user}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="mb-9 flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Private workspace</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.045em] text-[var(--ink)] sm:text-4xl">Your financial picture</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">A considered view of your information, decisions, and supporting context.</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-[var(--line)] bg-white px-3 py-1.5 sm:self-auto">
            <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[var(--muted)]">{user ? "Session verified" : "Checking session"}</span>
          </div>
        </div>

        <section className="mb-8" id="financial-twin" aria-labelledby="financial-twin-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">01 · Your foundation</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id="financial-twin-heading">Financial Twin</h2>
            </div>
            <span className="hidden text-xs text-[var(--muted)] sm:block">Your financial information, clearly organized</span>
          </div>
          {profileState === "loading" && <LoadingState label="Verifying your session and profile…" />}
          {profileState === "missing" && <StatusPanel eyebrow="Profile not found" title="Your workspace is ready when you are." description="There is no saved Financial Twin profile for this account yet. NEXUS has not created one or filled in any financial values." tone="warning" />}
          {profileState === "available" && <StatusPanel eyebrow="Connected" title="Your profile is available." description="This workspace does not yet display financial metrics." />}
          {profileState === "error" && <StatusPanel eyebrow="Could not load workspace" title={user ? "Your session is still protected." : "The workspace could not connect."} description={pageError || "The profile request failed. Please try again."} action={{ label: "Try again", onClick: retry }} tone="error" />}
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          {futureSections.map((section) => (
            <section className="scroll-mt-28" id={section.id} key={section.id}>
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{section.index} · Planned section</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--ink)]">{section.title}</h2>
              </div>
              <StatusPanel title="Not available yet" description={section.description} />
            </section>
          ))}
        </div>
        <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">NEXUS · Your private workspace</footer>
      </main>
    </div>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "API_UNAVAILABLE") return error.message;
  if (error instanceof ApiClientError) return error.message;
  return "An unexpected error occurred while loading your workspace.";
}
