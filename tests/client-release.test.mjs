import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyClientScripts,verifyHtmlIds} from '../scripts/verify-client-release.mjs';
const report=fs.readFileSync('public/report-downloads.js','utf8'),app=fs.readFileSync('public/app.js','utf8');
test('the actual report and app scripts can start together',()=>assert.doesNotThrow(()=>verifyClientScripts(report,app)));
test('duplicate export declarations and functions fail pre-release validation',()=>{
  assert.throws(()=>verifyClientScripts(report+'\nlet reportDownloadBusy=false;',app),/already been declared/);
  assert.throws(()=>verifyClientScripts(report+'\nfunction downloadReport(){}',app),/Duplicate report function/);
});
test('missing and duplicated download controls fail pre-release validation',()=>{
  const ids=['att-pdf','att-docx','appraisal-pdf','appraisal-docx'];
  const html=ids.map(id=>`<button id="${id}">Export</button>`).join('');
  assert.doesNotThrow(()=>verifyHtmlIds(html));
  assert.throws(()=>verifyHtmlIds(html+'<button id="att-pdf"></button>'),/Duplicate page controls/);
  assert.throws(()=>verifyHtmlIds('<main></main>'),/Missing download control/);
});
