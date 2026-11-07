"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Thresholds } from "@/lib/thresholds";

type Section = keyof Thresholds;

export interface FieldDef {
  name: string;
  label: string;
  help: string;
  step?: string;
}

export function ThresholdsForm({
  section,
  title,
  fields,
  values,
}: {
  section: Section;
  title: string;
  fields: FieldDef[];
  values: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(body: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/thresholds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: json.error ?? "Failed" });
    if (res.ok) router.refresh();
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch = Object.fromEntries(fields.map((f) => [f.name, Number(fd.get(f.name))]));
    return post({ patch: { [section]: patch } }, "Saved. Applies from the next audit.");
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border p-5">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="font-medium">{f.label}</span>
            <input
              name={f.name}
              type="number"
              step={f.step ?? "any"}
              required
              defaultValue={values[f.name]}
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-neutral-500">{f.help}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black">
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => post({ reset: [section] }, "Reset to defaults.")}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Reset to defaults
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
