"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Platform } from "@/lib/platforms/types";

export function RunAuditButton({ platform, label }: { platform: Platform; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "Audit failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy ? "Running…" : `Audit ${label}`}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function ScheduleToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <button onClick={toggle} disabled={busy} className="rounded-md border px-3 py-1 text-xs disabled:opacity-50">
      {enabled ? "Pause weekly audits" : "Resume weekly audits"}
    </button>
  );
}

export function DecisionButtons({ id, actionable }: { id: number; actionable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/recommendations/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "Failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {actionable && (
          <button onClick={() => decide("approve")} disabled={busy} className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            Approve
          </button>
        )}
        <button onClick={() => decide("reject")} disabled={busy} className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50">
          {actionable ? "Deny" : "Dismiss"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function RefreshOverlayButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/overlay", { method: "POST" });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "Refresh failed");
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={refresh} disabled={busy} className="rounded-md border px-3 py-1 text-xs disabled:opacity-50">
        {busy ? "Refreshing…" : "Refresh numbers"}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
