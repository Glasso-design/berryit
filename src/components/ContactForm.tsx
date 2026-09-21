"use client";

import { useState, type FormEvent } from "react";
import { buildTypes, helpAreas, intents, MAX_FILES } from "@/lib/contact-options";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

const input =
  "mt-2 w-full rounded-xl border border-line bg-ink px-4 py-3 text-paper placeholder:text-muted/60 transition focus:border-berry focus:outline-none";

function Chip({
  type,
  name,
  value,
  label,
  checked,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${
        checked ? "border-berry bg-berry/15 text-paper" : "border-line text-paper/80 hover:border-muted"
      }`}
    >
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

function Step({ n, title, children, error }: { n: string; title: string; children: React.ReactNode; error?: string }) {
  return (
    <fieldset className="border-t border-line pt-8">
      <legend className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-berry-2">{n}</span>
        <span className="font-display text-xl font-semibold">{title}</span>
      </legend>
      <div className="mt-5">{children}</div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-berry-2">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function ContactForm({ initialArea, initialIntent }: { initialArea?: string; initialIntent?: string }) {
  const [areas, setAreas] = useState<string[]>(
    initialArea && helpAreas.some((a) => a.value === initialArea) ? [initialArea] : [],
  );
  const [intent, setIntent] = useState(
    initialIntent && intents.some((i) => i.value === initialIntent) ? initialIntent : "",
  );
  const [buildType, setBuildType] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const toggleArea = (v: string) => setAreas((prev) => (prev.includes(v) ? prev.filter((a) => a !== v) : [...prev, v]));
  const building = intent === "bygga";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!building) fd.delete("buildType");

    const local: Record<string, string> = {};
    if (areas.length === 0) local.areas = "Välj minst ett område.";
    if (!intent) local.intent = "Välj vad du vill göra.";
    if (building && !buildType) local.buildType = "Välj vad du vill bygga.";
    if (String(fd.get("description") ?? "").trim().length < 10)
      local.description = "Beskriv kort vad du behöver hjälp med.";
    if (String(fd.get("name") ?? "").trim().length < 2) local.name = "Skriv ditt namn.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fd.get("email") ?? "").trim()))
      local.email = "Ange en giltig e-postadress.";
    if ((fd.getAll("files") as File[]).filter((f) => f.size > 0).length > MAX_FILES)
      local.files = `Max ${MAX_FILES} filer.`;
    setErrors(local);
    if (Object.keys(local).length) {
      setStatus({ kind: "error", message: "Kontrollera de markerade fälten." });
      return;
    }

    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/contact", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(json.fieldErrors ?? {});
        setStatus({ kind: "error", message: json.error ?? "Något gick fel." });
        return;
      }
      setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", message: "Kunde inte skicka. Kontrollera anslutningen och försök igen." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-signal/40 bg-signal/5 p-8">
        <p className="font-display text-2xl font-semibold">Tack! Vi har fått din förfrågan.</p>
        <p className="mt-3 text-muted">Vi återkommer så snart vi kan.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-10">
      <Step n="01" title="Jag behöver hjälp med" error={errors.areas}>
        <div className="flex flex-wrap gap-2">
          {helpAreas.map((a) => (
            <Chip
              key={a.value}
              type="checkbox"
              name="areas"
              value={a.value}
              label={a.label}
              checked={areas.includes(a.value)}
              onChange={() => toggleArea(a.value)}
            />
          ))}
        </div>
      </Step>

      <Step n="02" title="Vad vill du göra?" error={errors.intent}>
        <div className="flex flex-wrap gap-2">
          {intents.map((i) => (
            <Chip
              key={i.value}
              type="radio"
              name="intent"
              value={i.value}
              label={i.label}
              checked={intent === i.value}
              onChange={() => setIntent(i.value)}
            />
          ))}
        </div>
      </Step>

      {building && (
        <Step n="02b" title="Vad vill du bygga?" error={errors.buildType}>
          <div className="flex flex-wrap gap-2">
            {buildTypes.map((b) => (
              <Chip
                key={b.value}
                type="radio"
                name="buildType"
                value={b.value}
                label={b.label}
                checked={buildType === b.value}
                onChange={() => setBuildType(b.value)}
              />
            ))}
          </div>
        </Step>
      )}

      <Step n="03" title="Berätta mer">
        <label className="block">
          <span className="text-sm text-muted">Beskrivning *</span>
          <textarea
            name="description"
            required
            maxLength={5000}
            rows={6}
            placeholder="Beskriv med dina egna ord – du behöver inte veta vad problemet heter."
            className={input}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "err-description" : undefined}
          />
          {errors.description && (
            <span id="err-description" className="mt-1 block text-sm text-berry-2">
              {errors.description}
            </span>
          )}
        </label>
        {building && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-muted">Eventuell budget</span>
              <input name="budget" maxLength={120} className={input} placeholder="T.ex. 50 000 kr eller ”vet inte”" />
            </label>
            <label className="block">
              <span className="text-sm text-muted">Önskad tidplan</span>
              <input name="timeline" maxLength={120} className={input} placeholder="T.ex. till sommaren" />
            </label>
          </div>
        )}
        <label className="mt-5 block">
          <span className="text-sm text-muted">Filer (skärmbilder, skisser, dokument – max {MAX_FILES} st, 10 MB/st)</span>
          <input
            type="file"
            name="files"
            multiple
            className="mt-2 block w-full text-sm text-muted file:mr-4 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-4 file:py-2 file:text-paper hover:file:bg-white/[0.12]"
          />
          {errors.files && <span className="mt-1 block text-sm text-berry-2">{errors.files}</span>}
        </label>
      </Step>

      <Step n="04" title="Kontaktuppgifter">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-muted">Namn *</span>
            <input
              name="name"
              required
              maxLength={120}
              autoComplete="name"
              className={input}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "err-name" : undefined}
            />
            {errors.name && (
              <span id="err-name" className="mt-1 block text-sm text-berry-2">
                {errors.name}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-sm text-muted">Företag</span>
            <input name="company" autoComplete="organization" maxLength={160} className={input} />
          </label>
          <label className="block">
            <span className="text-sm text-muted">E-post *</span>
            <input
              name="email"
              type="email"
              maxLength={254}
              required
              autoComplete="email"
              className={input}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "err-email" : undefined}
            />
            {errors.email && (
              <span id="err-email" className="mt-1 block text-sm text-berry-2">
                {errors.email}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-sm text-muted">Telefon</span>
            <input name="phone" type="tel" autoComplete="tel" maxLength={40} className={input} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm text-muted">Ort</span>
            <input name="city" autoComplete="address-level2" maxLength={80} className={input} />
          </label>
        </div>
        {/* Honeypot för bottar */}
        <div aria-hidden className="absolute -left-[9999px]">
          <label>
            Lämna tomt
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      </Step>

      <div className="flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={status.kind === "sending"}
          className="inline-flex items-center justify-center rounded-full bg-berry px-8 py-3.5 font-semibold text-white shadow-[0_8px_30px_-8px_var(--berry)] transition hover:bg-berry-deep disabled:opacity-60"
        >
          {status.kind === "sending" ? "Skickar…" : "Skicka förfrågan"}
        </button>
        {status.kind === "error" && (
          <p role="alert" className="text-sm text-berry-2">
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}
