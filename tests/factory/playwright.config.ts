import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'workflow.spec.ts',workers:1,timeout:120000,expect:{timeout:10000},reporter:'list',use:{headless:true,trace:'retain-on-failure'},outputDir:'../../test-results/platform-factory-browser'});
