// node:test reporter that turns results into GitHub check-run annotations
// (logs are not readable from the audit container; annotations are).
// One ::notice summary per suite file, at most 8 ::error annotations.
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A").replace(/::/g, ": :");
export default async function* reporter(source) {
  const suite = process.env.MP1_SUITE || "mp1";
  let pass = 0, fail = 0, errors = 0;
  const passed = [];
  const failed = [];
  for await (const event of source) {
    if (event.type === "test:pass" && event.data.details?.type !== "suite") { pass++; passed.push(event.data.name); }
    if (event.type === "test:fail" && event.data.details?.type !== "suite") {
      fail++;
      const err = event.data.details?.error;
      const cause = err?.cause ?? err;
      const at = String(cause?.stack ?? "").split("\n").filter((l) => l.trim().startsWith("at ")).slice(0, 2).join("\n");
      const message = `${cause?.message ?? err?.message ?? "fail"}${at ? "\n" + at : ""}`;
      failed.push(event.data.name);
      if (errors < 8) { errors++; yield `::error title=${esc(suite + ": " + event.data.name).slice(0, 200)}::${esc(message).slice(0, 3000)}\n`; }
    }
    if (event.type === "test:diagnostic" && /^MP1 /.test(event.data.message)) yield `${event.data.message}\n`;
    if (event.type === "test:stdout" || event.type === "test:stderr") yield event.data.message;
  }
  const summary = `${pass} pass, ${fail} fail. PASS: ${passed.join(" | ")}${failed.length ? ` || FAIL: ${failed.join(" | ")}` : ""}`;
  yield `::notice title=${esc(suite)}::${esc(summary).slice(0, 3800)}\n`;
}
