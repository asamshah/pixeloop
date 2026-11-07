"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectionKind } from "@/lib/platforms/types";

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  help?: string;
  secret?: boolean;
  optional?: boolean;
}

export function ConnectForm({
  platform,
  fields,
  connectedAs,
}: {
  platform: ConnectionKind;
  fields: Field[];
  connectedAs: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!connectedAs);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = e.currentTarget;
    const credentials = Object.fromEntries(
      fields.map((f) => [f.name, String(new FormData(form).get(f.name) ?? "")]),
    );
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, credentials }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Failed");
    form.reset(); // secrets never stay in the DOM
    setEditing(false);
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect and delete the stored credentials?")) return;
    await fetch("/api/connections", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    setEditing(true);
    router.refresh();
  }

  if (!editing && connectedAs) {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-green-700 dark:text-green-400">
          ✓ Connected: {connectedAs}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="rounded-md border px-3 py-1 text-xs">
            Replace credentials
          </button>
          <button onClick={disconnect} className="rounded-md border px-3 py-1 text-xs text-red-600">
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-3">
      {fields.map((f) => (
        <label key={f.name} className="block text-sm">
          <span className="font-medium">
            {f.label}
            {f.optional && <span className="ml-1 font-normal text-neutral-500">(optional)</span>}
          </span>
          <input
            name={f.name}
            type={f.secret ? "password" : "text"}
            required={!f.optional}
            placeholder={f.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
          />
          {f.help && <span className="mt-1 block text-xs text-neutral-500">{f.help}</span>}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? "Testing connection…" : "Test & save"}
        </button>
        {connectedAs && (
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-neutral-500">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
