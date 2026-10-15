import { z } from "zod";
import type { SupportClient } from "./support-workflow";
import { ticketDraftSchema } from "./schemas";
const uuid=z.uuid();
const actions=z.discriminatedUnion("action",[
  z.object({action:z.literal("overview"),args:z.object({}).strict()}),
  z.object({action:z.literal("detail"),args:z.object({id:uuid}).strict()}),
  z.object({action:z.literal("create"),args:z.object({input:ticketDraftSchema.extend({customerId:uuid})}).strict()}),
  z.object({action:z.literal("message"),args:z.object({id:uuid,body:z.string().max(20000),staff:z.boolean()}).strict()}),
  z.object({action:z.literal("note"),args:z.object({id:uuid,body:z.string().max(20000)}).strict()}),
  z.object({action:z.literal("update"),args:z.object({id:uuid,changes:z.object({status_key:z.string().optional(),assignee_id:uuid.nullable().optional()}).strict()}).strict()}),
  z.object({action:z.literal("reopen"),args:z.object({id:uuid,reason:z.string().trim().min(3).max(1000)}).strict()}),
  z.object({action:z.literal("upload"),args:z.object({id:uuid,visibility:z.enum(["customer","internal"]),retryId:uuid.optional()}).strict()}),
  z.object({action:z.literal("download"),args:z.object({attachmentId:uuid}).strict()}),
  z.object({action:z.literal("organization"),args:z.object({name:z.string().trim().min(2).max(200),orgNo:z.string().max(30)}).strict()}),
]);
export async function executeSupportAction(client:SupportClient,input:unknown,file?:File){
  const payload=actions.parse(input);
  switch(payload.action){
    case "overview":return client.overview();case "detail":return client.detail(payload.args.id);case "create":return client.create(payload.args.input);
    case "message":return client.message(payload.args.id,payload.args.body,payload.args.staff);case "note":return client.note(payload.args.id,payload.args.body);
    case "update":return client.update(payload.args.id,payload.args.changes);case "reopen":return client.reopen(payload.args.id,payload.args.reason);
    case "upload":if(!file)throw new Error("Välj en fil.");return client.upload(payload.args.id,file,payload.args.visibility,payload.args.retryId);
    case "download":return client.download(payload.args.attachmentId);case "organization":return client.organization(payload.args.name,payload.args.orgNo);
  }
}
