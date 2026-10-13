"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { startMfa, verifyMfa, type EnrollState } from "./actions";

/**
 * TOTP-flödet. Allt backend-anrop sker i server actions med användarens egen
 * session – ingen nyckel och ingen session exponeras för webbläsaren.
 */
export function MfaFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<EnrollState>({ kind: "idle" });
  const [state, action, pending] = useActionState(verifyMfa, undefined);
  // Inskrivningen får bara startas en gång. Ett andra anrop skulle avregistrera
  // faktorn som det första just skapade och lämna en hemlighet som inte går att
  // verifiera.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startMfa().then(setStage);
  }, []);

  useEffect(() => {
    if (!state?.done) return;
    router.replace("/control");
    router.refresh();
  }, [state?.done, router]);

  if (stage.kind === "idle") return <p className="mt-8 text-muted">Hämtar tvåfaktorstatus…</p>;

  if (stage.kind === "fel")
    return (
      <p role="alert" className="mt-8 rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
        Kunde inte starta tvåfaktor: {stage.message}
      </p>
    );

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="factorId" value={stage.factorId} />

      {stage.kind === "registrera" && (
        <div className="rounded-2xl border border-line bg-ink-2 p-5">
          <p className="text-sm text-muted">
            Lägg till BERRYiT Control Center i din autentiseringsapp och ange sedan koden.
          </p>
          <p className="mt-3 text-sm text-muted">Hemlighet:</p>
          <code className="mt-1 block rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm break-all">
            {stage.secret}
          </code>
        </div>
      )}

      <label className="block">
        <span className="text-sm text-muted">Engångskod</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          required
          className="mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-paper focus:border-berry focus:outline-none"
        />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-berry px-6 py-3 font-semibold text-white transition hover:bg-berry-deep disabled:opacity-60"
      >
        {pending ? "Verifierar…" : stage.kind === "registrera" ? "Aktivera tvåfaktor" : "Verifiera"}
      </button>
    </form>
  );
}
