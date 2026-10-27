import { z } from 'zod';
export const DEFAULT_STORAGE_QUOTA = 1_000_000_000;
const uuid=z.string().uuid();
const label=z.string().trim().min(2).max(120).refine(v=>!/(?:eyJ[A-Za-z0-9_-]{8,}\.|sb_secret_|sk_live_|-----BEGIN)/.test(v),'Hemligheter får inte användas som namn.');
export const factoryRequestSchema=z.object({
 productId:z.string().regex(/^[a-z][a-z0-9-]{1,50}$/),version:z.string().regex(/^[a-f0-9]{40}$/),
 organizationId:uuid,projectId:uuid,ownerId:uuid,name:label,customerName:label,
 domain:z.string().toLowerCase().regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
 region:z.enum(['eu','eea','us']),accountMode:z.enum(['DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION']),
 emailMode:z.enum(['none','routing','transactional','mailbox']),storageQuotaBytes:z.number().int().min(1).max(1_000_000_000_000).default(DEFAULT_STORAGE_QUOTA),
 monthlyBudgetCents:z.number().int().min(0).max(1_000_000),idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
 addons:z.array(z.string().regex(/^[a-z][a-z-]{1,59}$/)).max(20).default([]),
}).strict();
