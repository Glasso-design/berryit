import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticPreviews,diagnosticResponse,diagnosticPrompt} from './diagnostics.mjs';
const context={facts:[{id:'M-1',text:'cpu_percent=99',at:'2026-10-16T12:00Z',origin:'agent'}],missingInformation:['Inga serverloggar har undersökts.']};
test('approval is actor/conversation-bound, one-use and cannot accept changed context',()=>{
 const p=new DiagnosticPreviews();let preview=p.prepare('a','c',context);
 assert.equal(p.consume(preview.previewId,'b','c',context),false);
 assert.equal(p.consume(preview.previewId,'a','other',context),false);
 assert.equal(p.consume(preview.previewId,'a','c',context),true);
 assert.equal(p.consume(preview.previewId,'a','c',context),false);
 preview=p.prepare('a','c',context);assert.equal(p.consume(preview.previewId,'a','c',{...context,facts:[]}),false);
});
test('approval expires and a new preview invalidates the old one',()=>{
 let now=1000;const p=new DiagnosticPreviews(()=>now),first=p.prepare('a','c',context),second=p.prepare('a','c',context);
 assert.equal(p.consume(first.previewId,'a','c',context),false);now+=300001;
 assert.equal(p.consume(second.previewId,'a','c',context),false);
});
test('AI assertions never become verified facts and missing connection remains explicit',()=>{
 const response=diagnosticResponse({summary:'Möjlig CPU-överlast',verifiedFacts:[{text:'Jag undersökte servern',sourceIds:['M-1']}],hypotheses:[],recommendedActions:[],missingInformation:[],sources:[]},context);
 assert.match(response.verifiedFacts[0].text,/cpu_percent=99/);assert.equal(response.hypotheses.length,0);
 assert.deepEqual(response.missingInformation,context.missingInformation);assert.match(diagnosticPrompt(context),/INTE anslutit/);
});
