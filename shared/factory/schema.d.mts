import type { z } from 'zod';
export const DEFAULT_STORAGE_QUOTA:1_000_000_000;
export type FactoryRequest={productId:string;version:string;organizationId:string;projectId:string;ownerId:string;name:string;customerName:string;domain:string;region:'eu'|'eea'|'us';accountMode:'DEDICATED_MANAGED'|'LIMITED_STANDALONE'|'MANAGED_RESOURCE_ISOLATION';emailMode:'none'|'routing'|'transactional'|'mailbox';storageQuotaBytes:number;monthlyBudgetCents:number;idempotencyKey:string;addons:string[]};
export const factoryRequestSchema:z.ZodType<FactoryRequest>;
