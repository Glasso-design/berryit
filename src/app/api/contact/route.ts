import { NextResponse } from "next/server";
import { buildTypes, contactSchema, helpAreas, intents, labelFor, MAX_FILE_BYTES, MAX_FILES } from "@/lib/contact";

/*
 * Tar emot förfrågningar från kontaktformuläret.
 *
 * Leverans: om CONTACT_WEBHOOK_URL är satt skickas förfrågan (inkl. filer)
 * som multipart/form-data dit – t.ex. en e-post-/automationstjänst.
 * Utan webhook svarar routen 503 så att ingen förfrågan tyst försvinner.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }

  const parsed = contactSchema.safeParse({
    areas: form.getAll("areas"),
    intent: form.get("intent") ?? undefined,
    buildType: form.get("buildType") || undefined,
    name: form.get("name") ?? "",
    company: form.get("company") ?? undefined,
    phone: form.get("phone") ?? undefined,
    email: form.get("email") ?? "",
    city: form.get("city") ?? undefined,
    description: form.get("description") ?? "",
    budget: form.get("budget") ?? undefined,
    timeline: form.get("timeline") ?? undefined,
    website: form.get("website") ?? "",
  });

  // Honeypot ifylld → bot. Generiskt fel, avslöja inte fältet.
  if (!parsed.success && parsed.error.issues.some((i) => i.path[0] === "website")) {
    return NextResponse.json({ error: "Förfrågan kunde inte tas emot." }, { status: 400 });
  }

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return NextResponse.json({ error: "Kontrollera formuläret.", fieldErrors }, { status: 422 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Max ${MAX_FILES} filer.`, fieldErrors: { files: `Max ${MAX_FILES} filer.` } }, { status: 422 });
  }
  if (files.some((f) => f.size > MAX_FILE_BYTES)) {
    return NextResponse.json({ error: "En fil är för stor.", fieldErrors: { files: "Max 10 MB per fil." } }, { status: 422 });
  }

  const d = parsed.data;
  const webhook = process.env.CONTACT_WEBHOOK_URL;
  if (!webhook) {
    console.warn("[contact] CONTACT_WEBHOOK_URL saknas – förfrågan kunde inte levereras.");
    return NextResponse.json(
      {
        error:
          "Kontaktfunktionen är ännu inte ansluten till en mottagare. Din förfrågan har inte skickats – dina uppgifter finns kvar i formuläret.",
      },
      { status: 503 },
    );
  }

  const out = new FormData();
  out.set(
    "summary",
    [
      `Område: ${d.areas.map((a) => labelFor(helpAreas, a)).join(", ")}`,
      `Vill: ${labelFor(intents, d.intent)}`,
      d.buildType && `Bygga: ${labelFor(buildTypes, d.buildType)}`,
      `Namn: ${d.name}`,
      d.company && `Företag: ${d.company}`,
      `E-post: ${d.email}`,
      d.phone && `Telefon: ${d.phone}`,
      d.city && `Ort: ${d.city}`,
      d.budget && `Budget: ${d.budget}`,
      d.timeline && `Tidplan: ${d.timeline}`,
      "",
      d.description,
    ]
      .filter((l): l is string => typeof l === "string")
      .join("\n"),
  );
  out.set("data", JSON.stringify({ ...d, website: undefined }));
  for (const f of files) out.append("files", f, f.name);

  try {
    const res = await fetch(webhook, { method: "POST", body: out, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
  } catch (err) {
    console.error("[contact] leverans misslyckades", err);
    return NextResponse.json({ error: "Något gick fel. Försök igen om en stund." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
