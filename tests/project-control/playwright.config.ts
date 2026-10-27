import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'workflow.spec.ts',workers:1,fullyParallel:false,timeout:120000,expect:{timeout:10000},reporter:'list',use:{headless:true,actionTimeout:10000,viewport:{width:1440,height:1080},trace:'retain-on-failure'},outputDir:'../../test-results/project-control-browser'});
