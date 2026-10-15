import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Organization, TicketRow } from "./domain";
import { ticketDraftSchema } from "./schemas";

export type Customer = { id: string; full_name: string | null; email: string | null; phone: string | null; organization_id: string | null; login_activation_pending: boolean };
export type Ticket = TicketRow & { requester_id: string; description: string; category_key: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; created_at: string; resolved_at: string | null; closed_at: string | null };
export type Lookup = { key: string; label: string };
export type TicketMessage = { id: string; author_id: string; body: string; is_from_staff: boolean; created_at: string };
export type TicketNote = { id: string; author_id: string; body: string; created_at: string };
export type TicketAttachment = { id: string; ticket_id: string; uploaded_by: string; file_name: string; mime_type: string; size_bytes: number; visibility: "customer" | "internal"; upload_completed_at: string | null; created_at: string };
export type TicketEvent = { id: string; actor_id: string | null; event_type: string; from_value: string | null; to_value: string | null; payload: Record<string, unknown>; created_at: string };
export type Technician = { id: string; label: string; is_external: boolean; expires_at: string | null };
export type SupportOverview = { tickets: Ticket[]; customers: Customer[]; organizations: Organization[]; categories: Lookup[]; statuses: Lookup[]; canRegister: boolean };
export type TicketDetail = { ticket: Ticket; canWork: boolean; messages: TicketMessage[]; notes: TicketNote[]; attachments: TicketAttachment[]; events: TicketEvent[]; technicians: Technician[]; people: { id: string; label: string }[] };
export type NewTicket = { customerId: string; subject: string; description: string; category_key: string };
export const customerRegistrationSchema = z.object({
  full_name: z.string().trim().min(2).max(200), email: z.string().trim().email().max(254),
  phone: z.string().trim().max(60).default(""), organization_id: z.uuid().nullable(),
}).strict();
export type CustomerRegistration = z.infer<typeof customerRegistrationSchema>;
export type SupportClient = {
  overview(): Promise<SupportOverview>;
  detail(id: string): Promise<TicketDetail>;
  create(input: NewTicket): Promise<string>;
  message(id: string, body: string, staff: boolean): Promise<void>;
  note(id: string, body: string): Promise<void>;
  update(id: string, changes: { status_key?: string; assignee_id?: string | null }): Promise<void>;
  reopen(id: string, reason: string): Promise<void>;
  upload(id: string, file: File, visibility: "customer" | "internal", retryId?: string): Promise<void>;
  download(attachmentId: string): Promise<string>;
  register(input: CustomerRegistration): Promise<void>;
  organization(name: string, orgNo: string): Promise<void>;
};

const TICKET_SELECT = "id,reference,subject,description,requester_id,status_key,priority_key,category_key,organization_id,assignee_id,contact_name,contact_email,contact_phone,created_at,updated_at,resolved_at,closed_at";
const CUSTOMER_SELECT = "id,full_name,email,phone,organization_id,login_activation_pending";
const ATTACHMENT_SELECT = "id,ticket_id,uploaded_by,file_name,mime_type,size_bytes,visibility,upload_completed_at,created_at";
const failed = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const text = (body: string) => z.string().trim().min(1, "Skriv en text.").max(20000).parse(body);
export const SUPPORT_FILE_TYPES = ["image/png","image/jpeg","image/gif","image/webp","image/heic","application/pdf","text/plain","text/csv","application/zip","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-outlook","message/rfc822"];
export function validateSupportFile(file: File) {
  if (file.size <= 0 || file.size > 26214400) throw new Error("Bilagan måste vara mellan 1 byte och 25 MB.");
  if (!SUPPORT_FILE_TYPES.includes(file.type)) throw new Error("Filtypen är inte tillåten.");
  if (!file.name.trim() || file.name.length > 255 || [...file.name].some(character=>character.charCodeAt(0)<32)) throw new Error("Ogiltigt filnamn.");
}

/** Shared by Desktop and the portal's authenticated server route. No secrets. */
export function createSupportClient(supabase: SupabaseClient, userId: string, register?: SupportClient["register"]): SupportClient {
  async function all<T>(table: string, columns: string, filters: [string, string | boolean][] = []): Promise<T[]> {
    const rows: T[] = []; let after = "";
    for (;;) {
      let query = supabase.from(table).select(columns).order("id").limit(200);
      for (const [key, value] of filters) query = query.eq(key, value);
      if (after) query = query.gt("id", after);
      const result = await query; failed(result.error);
      const page = (result.data ?? []) as unknown as {id:string}[]; if (!page.length) return rows;
      const next = String(page[page.length - 1].id);
      if (!z.uuid().safeParse(next).success || (after && next <= after)) throw new Error("Ofullständig hämtning. Försök igen.");
      rows.push(...page as unknown as T[]); after = next;
    }
  }
  async function lookup(table: string): Promise<Lookup[]> {
    const result = await supabase.from(table).select("key,label").eq("is_active", true).order("sort_order");
    failed(result.error); return result.data ?? [];
  }
  async function rpc<T>(name: string, args = {}): Promise<T> {
    const result = await supabase.rpc(name, args); failed(result.error); return result.data as T;
  }
  return {
    async overview() {
      const [tickets, customers, organizations, categories, statuses, canRegister] = await Promise.all([
        all<Ticket>("tickets", TICKET_SELECT), all<Customer>("profiles", CUSTOMER_SELECT, [["role", "customer"], ["is_active", true]]),
        all<Organization>("organizations", "id,name,org_no"), lookup("ticket_categories"), lookup("ticket_statuses"),
        rpc<boolean>("can_register_support_customer"),
      ]);
      return { tickets: tickets.sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)), customers, organizations, categories, statuses, canRegister: canRegister === true };
    },
    async detail(id) {
      z.uuid().parse(id);
      const [result, canWork] = await Promise.all([
        supabase.from("tickets").select(TICKET_SELECT).eq("id", id).maybeSingle(), rpc<boolean>("can_work_ticket", { p_ticket_id: id }),
      ]);
      failed(result.error); if (!result.data) throw new Error("Ärendet finns inte eller är inte tillgängligt.");
      const [messages, notes, attachments, events, technicians, people] = await Promise.all([
        all<TicketMessage>("ticket_messages", "id,author_id,body,is_from_staff,created_at", [["ticket_id",id]]),
        canWork ? all<TicketNote>("ticket_internal_notes", "id,author_id,body,created_at", [["ticket_id",id]]) : Promise.resolve([]),
        all<TicketAttachment>("ticket_attachments", ATTACHMENT_SELECT, [["ticket_id",id]]),
        all<TicketEvent>("ticket_events", "id,actor_id,event_type,from_value,to_value,payload,created_at", [["ticket_id",id]]),
        rpc<Technician[]>("support_ticket_technicians", {p_ticket_id:id}),
        rpc<{id:string;label:string}[]>("support_ticket_people", {p_ticket_id:id}),
      ]);
      return { ticket: result.data as Ticket, canWork: canWork === true, messages, notes, attachments, events, technicians, people };
    },
    async create(input) {
      const draft = ticketDraftSchema.parse(input); z.uuid().parse(input.customerId);
      const customer = await supabase.from("profiles").select(CUSTOMER_SELECT).eq("id",input.customerId).eq("role","customer").eq("is_active",true).maybeSingle();
      failed(customer.error); if (!customer.data) throw new Error("Kunden är inte tillgänglig.");
      const result = await supabase.from("tickets").insert({
        requester_id:customer.data.id, organization_id:customer.data.organization_id,
        subject:draft.subject,description:draft.description,category_key:draft.category_key,source:"portal",
        contact_name:customer.data.full_name,contact_email:customer.data.email,contact_phone:customer.data.phone,
      }).select("id").single(); failed(result.error); return result.data!.id;
    },
    async message(id, body, staff) {
      const result = await supabase.from("ticket_messages").insert({ticket_id:id,author_id:userId,body:text(body),is_from_staff:staff}); failed(result.error);
    },
    async note(id, body) {
      const result = await supabase.from("ticket_internal_notes").insert({ticket_id:id,author_id:userId,body:text(body)}); failed(result.error);
    },
    async update(id, changes) {
      const valid = z.object({status_key:z.enum(["mottaget","pagar","vantar_pa_kund","lost","stangt"]).optional(),assignee_id:z.uuid().nullable().optional()}).strict().parse(changes);
      const result = await supabase.from("tickets").update(valid).eq("id",id).select("id").maybeSingle();
      failed(result.error); if (!result.data) throw new Error("Ärendet kunde inte uppdateras. Behörigheten kan ha upphört.");
    },
    async reopen(id, reason) { await rpc("reopen_support_ticket",{p_ticket_id:id,p_reason:z.string().trim().min(3).max(1000).parse(reason)}); },
    async upload(id, file, visibility, retryId) {
      z.uuid().parse(id); validateSupportFile(file);
      let attachment: {id:string;storage_path:string};
      if (retryId) {
        const result = await supabase.from("ticket_attachments").select("id,storage_path,file_name,mime_type,size_bytes").eq("id",retryId).eq("ticket_id",id).eq("uploaded_by",userId).single();
        failed(result.error); const row = result.data!;
        if (row.file_name!==file.name || row.mime_type!==file.type || Number(row.size_bytes)!==file.size) throw new Error("Välj samma fil som registrerades för den här bilagan.");
        attachment = row;
        const completed = await supabase.rpc("complete_support_attachment",{p_attachment_id:row.id});
        if (!completed.error) return;
        if (completed.error.code!=="55000") throw new Error(completed.error.message);
      } else {
        const result = await supabase.from("ticket_attachments").insert({ticket_id:id,uploaded_by:userId,
          storage_path:`tickets/${id}/${crypto.randomUUID()}`,file_name:file.name,mime_type:file.type,size_bytes:file.size,visibility,
        }).select("id,storage_path").single(); failed(result.error); attachment=result.data!;
      }
      const uploaded = await supabase.storage.from("ticket-attachments").upload(attachment.storage_path,file,{contentType:file.type,upsert:false});
      if (uploaded.error) throw new Error("Bilagan är registrerad men uppladdningen misslyckades. Återuppta via bilagan.");
      await rpc("complete_support_attachment",{p_attachment_id:attachment.id});
    },
    async download(attachmentId) {
      const path = await rpc<string>("audit_support_attachment_access",{p_attachment_id:attachmentId});
      const result = await supabase.storage.from("ticket-attachments").createSignedUrl(path,60,{download:true});
      failed(result.error); if (!result.data?.signedUrl) throw new Error("Kunde inte hämta bilagan.");
      return result.data.signedUrl;
    },
    register: register ?? (() => Promise.reject(new Error("Kundregistrering kräver en konfigurerad Control Center-server."))),
    async organization(name, orgNo) { await rpc("create_support_organization",{p_name:name,p_org_no:orgNo}); },
  };
}

/** Browser portal uses its httpOnly cookie, not a browser-readable JWT. */
export function createPortalSupportClient(request: typeof fetch = fetch, base = "/api/control/support"): SupportClient {
  async function call<T>(action: string, args: Record<string,unknown> = {}, file?: File): Promise<T> {
    let body: BodyInit; let headers: HeadersInit | undefined;
    if (file) { const data = new FormData(); data.set("action",action); data.set("args",JSON.stringify(args)); data.set("file",file); body=data; }
    else { body=JSON.stringify({action,args}); headers={"Content-Type":"application/json"}; }
    const response = await request(base,{method:"POST",headers,body,credentials:"same-origin"});
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Åtgärden misslyckades.");
    return result.data as T;
  }
  return {
    overview:()=>call("overview"),detail:(id)=>call("detail",{id}),create:(input)=>call("create",{input}),
    message:(id,body,staff)=>call("message",{id,body,staff}),note:(id,body)=>call("note",{id,body}),
    update:(id,changes)=>call("update",{id,changes}),reopen:(id,reason)=>call("reopen",{id,reason}),
    upload:(id,file,visibility,retryId)=>call("upload",{id,visibility,retryId},file),download:(attachmentId)=>call("download",{attachmentId}),
    register:async(input)=>{const response=await request("/api/control/customers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),credentials:"same-origin"});const body=await response.json();if(!response.ok)throw new Error(body.error??"Kunden kunde inte registreras.");},
    organization:(name,orgNo)=>call("organization",{name,orgNo}),
  };
}
