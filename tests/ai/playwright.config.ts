import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'diagnostics.spec.ts',workers:1,timeout:120000,expect:{timeout:10000},reporter:'list',use:{headless:true,actionTimeout:10000,trace:'retain-on-failure'},outputDir:'../../test-results/ai-diagnostics'});
