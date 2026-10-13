"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const field =
  "mt-2 w-full rounded-xl border border-field bg-ink px-4 py-3 text-paper placeholder:text-muted focus:border-berry focus:outline-none";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />

      <label className="block">
        <span className="text-sm text-muted">E-post</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className={field}
          aria-invalid={state?.error ? true : undefined}
        />
      </label>

      <label className="block">
        <span className="text-sm text-muted">Lösenord</span>
        <input name="password" type="password" autoComplete="current-password" required className={field} />
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
        {pending ? "Loggar in…" : "Logga in"}
      </button>

      <p className="text-sm text-muted">
        Super Admin måste bekräfta med tvåfaktor (TOTP) efter inloggning.
      </p>
    </form>
  );
}
