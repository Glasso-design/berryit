import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { loadMessages, sendMessage } from "../src/registry/comm-data";
import { mergeMessages, newCursor } from "@berryit/shared/communications";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), foreign = id(2), staff = id(3), org = id(11), otherOrg = id(12);
const conv = id(21), otherConv = id(22);
const sameTime = "2026-10-14T12:00:00.123456Z";
let db: PGlite;
const read = (file: string) => readFileSync(new URL(`../../supabase/${file}`, import.meta.url), "utf8");

beforeAll(async () => {
  // This constructor has no URL, persistent path, credentials or network access.
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read("tests/local_bootstrap.sql"));
  for (const file of readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(read(`migrations/${file}`));
  }
  await db.exec(`
    insert into auth.users(id,email) values ('${user}','a@example.test'),('${foreign}','b@example.test'),('${staff}','staff@example.test');
    insert into public.organizations(id,name) values ('${org}','Synthetic A'),('${otherOrg}','Synthetic B');
    update public.profiles set organization_id='${org}' where id='${user}';
    update public.profiles set organization_id='${otherOrg}' where id='${foreign}';
    update public.profiles set role='technician' where id='${staff}';
    insert into public.comm_conversations(id,organization_id,channel_key) values ('${conv}','${org}','chat_customer'),('${otherConv}','${otherOrg}','chat_customer');
    insert into public.comm_participants(organization_id,conversation_id,profile_id) values ('${org}','${conv}','${user}');
    insert into public.comm_messages(id,organization_id,conversation_id,author_id,direction,body_text,created_at)
      select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'${org}','${conv}','${staff}','outbound','Synthetic '||n,'${sameTime}'::timestamptz
      from generate_series(1,1001) n;
    insert into public.comm_messages(organization_id,conversation_id,author_id,direction,body_text) values
      ('${org}','${conv}','${staff}','internal','Must stay private'),('${otherOrg}','${otherConv}','${staff}','outbound','Foreign');
  `);
}, 60000);
afterAll(async () => { await db?.close(); });

/** Narrow in-memory PostgREST transport for the REAL Supabase SDK/client paths.
 * It translates the emitted filters to parameterized SQL under real RLS.
 * It does not verify JWT signatures, HTTP PostgREST or signed URLs.
 */
function client({ maxPage = 500, failPage = 0 }: { maxPage?: number; failPage?: number } = {}) {
  const urls: URL[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (failPage && urls.length === failPage) return reply({ message: "Synthetic page failure", code: "test" }, 500);
    const table = url.pathname.split("/").pop();
    if (!["comm_messages", "comm_participants"].includes(table ?? "")) throw new Error("Unexpected test route");
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: "authenticated", aal: "aal1" })]);
      await db.exec("set local role authenticated");
      let result: unknown[] = [];
      if (init?.method === "POST") {
        const row = JSON.parse(String(init.body)) as Record<string, unknown>;
        const fields = Object.keys(row);
        if (fields.some((f) => !/^[a-z_]+$/.test(f))) throw new Error("Invalid fixture column");
        await db.query(`insert into public.${table}(${fields.join(",")}) values (${fields.map((_, n) => `$${n + 1}`).join(",")})`, Object.values(row));
      } else {
        const params: string[] = [];
        const filters: string[] = [];
        const parameter = (value: string) => { params.push(value); return `$${params.length}`; };
        for (const field of ["conversation_id", "created_at"]) {
          const filter = url.searchParams.get(field);
          if (!filter) continue;
          const match = /^(eq|gte)\.(.+)$/.exec(filter);
          if (!match) throw new Error("Unexpected filter");
          filters.push(`${field} ${match[1] === "eq" ? "=" : ">="} ${parameter(match[2])}`);
        }
        const or = url.searchParams.get("or");
        if (or) {
          const match = /^\(created_at\.gt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.gt\.([a-f0-9-]+)\)\)$/.exec(or);
          if (!match || match[1] !== match[2]) throw new Error("Unexpected keyset expression");
          filters.push(`(created_at,id) > (${parameter(match[1])}::timestamptz,${parameter(match[3])}::uuid)`);
        }
        if (url.searchParams.get("order") !== "created_at.asc,id.asc") throw new Error("Unstable sort");
        const limit = Math.min(Number(url.searchParams.get("limit")), maxPage);
        const response = await db.query<{ payload: unknown }>(`
          select to_jsonb(m) || jsonb_build_object('created_at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) payload
          from public.comm_messages m where ${filters.join(" and ") || "true"}
          order by created_at,id limit ${limit}`, params);
        result = response.rows.map((r) => r.payload);
      }
      await db.exec("commit");
      return reply(result);
    } catch (error) {
      await db.exec("rollback");
      const e = error as { message: string; code: string };
      return reply({ message: e.message, code: e.code }, 403);
    }
  };
  const sdk = createClient("http://isolated.invalid", "synthetic-test-key", {
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sdk, urls };
}

describe("Communications client + SQL/RLS", () => {
  it("SDK scale regression reads 26,001 rows over >50 pages without a hidden cap", async () => {
    const rows = Array.from({ length: 26001 }, (_, n) => ({
      id: id(n + 100), created_at: sameTime, conversation_id: conv, direction: "outbound",
    }));
    let calls = 0;
    const sdk = createClient("http://isolated.invalid", "synthetic-test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input) => {
        calls++;
        const url = new URL(String(input));
        const cursor = url.searchParams.get("or")?.match(/id\.gt\.([0-9a-f-]+)/)?.[1];
        const page = rows.filter((row) => !cursor || row.id > cursor).slice(0, 500);
        return new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json" } });
      } },
    });
    expect(await loadMessages(sdk, conv)).toHaveLength(26001);
    expect(calls).toBe(54);
  });

  it("a non-advancing API cursor fails visibly instead of looping or returning partial data", async () => {
    const sdk = createClient("http://isolated.invalid", "synthetic-test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify([{ id: id(100), created_at: sameTime }]), {
        headers: { "Content-Type": "application/json" },
      }) },
    });
    await expect(loadMessages(sdk, conv)).rejects.toThrow("Ofullständig");
  });

  it("SQL/RLS pagination retains 1,001 identical microsecond timestamps without loss", async () => {
    const { sdk, urls } = client();
    const messages = await loadMessages(sdk, conv);
    expect(messages).toHaveLength(1001);
    expect(new Set(messages.map((m) => m.id)).size).toBe(1001);
    expect(urls.length).toBe(4);
    expect(urls[1].searchParams.get("or")).toContain(`created_at.gt."${sameTime}"`);
    expect(messages.some((m) => m.direction === "internal")).toBe(false);
    expect(messages[0].created_at).toBe(sameTime);
  }, 60000);

  it("also handles an API page limit below the requested limit", async () => {
    const { sdk } = client({ maxPage: 333 });
    expect(await loadMessages(sdk, conv)).toHaveLength(1001);
  }, 60000);

  it("inclusive polling recovers a new lower ID at the same timestamp and deduplicates", async () => {
    const { sdk } = client();
    const first = await loadMessages(sdk, conv);
    const merged = mergeMessages([], first, newCursor());
    await db.query(`insert into public.comm_messages(id,organization_id,conversation_id,author_id,direction,body_text,created_at)
      values ($1,$2,$3,$4,'outbound','Late same timestamp',$5)`, [id(90),org,conv,staff,sameTime]);
    const next = await loadMessages(sdk, conv, merged.cursor.since);
    const result = mergeMessages(first, next, merged.cursor);
    expect(result.messages).toHaveLength(1002);
    expect(result.added).toBe(1);
    expect(next).toHaveLength(1002);
  }, 60000);

  it("a later page error rejects the entire fetch instead of returning partial success", async () => {
    await expect(loadMessages(client({ failPage: 3 }).sdk, conv)).rejects.toThrow("Synthetic page failure");
  });

  it("rejects an injected timestamp before making a request", async () => {
    const { sdk, urls } = client();
    await expect(loadMessages(sdk, conv, "2026-10-14,and(id.neq.null)")).rejects.toThrow("Ogiltig");
    expect(urls).toHaveLength(0);
  });

  it("manipulated conversation IDs never return another organisation's messages", async () => {
    expect(await loadMessages(client().sdk, otherConv)).toEqual([]);
  });

  it("client cannot create internal messages or use another organisation ID", async () => {
    const { sdk } = client();
    const base = { conversationId: conv, organizationId: org, userId: user, body: "Synthetic client" };
    expect((await sendMessage(sdk, { ...base, internal: true })).error).toBeTruthy();
    expect((await sendMessage(sdk, { ...base, conversationId: otherConv, organizationId: otherOrg })).error).toBeTruthy();
    expect((await sendMessage(sdk, { ...base, organizationId: otherOrg })).error).toBeTruthy();
    expect((await sendMessage(sdk, base)).error).toBeUndefined();
  });

  it("direct SDK participant insertion with foreign profile ID is rejected by RLS", async () => {
    const result = await client().sdk.from("comm_participants").insert({ organization_id: org, conversation_id: conv, profile_id: foreign });
    expect(result.error?.code).toBe("42501");
  });
});
