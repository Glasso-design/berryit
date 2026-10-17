import {spawn} from 'node:child_process';
import {assertIsolatedPgliteEnvironment} from '../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=tests/access/playwright.config.ts'],{stdio:'inherit',env:{...process.env,BERRYIT_WORKFLOW_TEST:'isolated-pglite'}});
child.on('exit',code=>{process.exitCode=code??1;});child.on('error',error=>{console.error(error);process.exitCode=1;});
