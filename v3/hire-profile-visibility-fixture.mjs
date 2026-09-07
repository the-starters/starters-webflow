// Generate a network-free rendered regression fixture using the actual controller.
// Usage: node v3/hire-profile-visibility-fixture.mjs OUTPUT.html [SOURCE.js]
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [output, sourcePath] = process.argv.slice(2);
assert(output, 'Provide an output HTML path');
const source = fs.readFileSync(sourcePath || new URL('./hire-profile.js', import.meta.url), 'utf8');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cases = [];
for (const ready of [false, true]) for (const hidden of [false, true]) cases.push({ ready, hidden });
const frames = cases.map(({ ready, hidden }, caseId) => {
  const page = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
body{font:16px Arial;padding:18px;color:#202632}button{padding:12px 20px;margin-right:8px}
.booking-button-wrapper{display:contents}
/* Exact default-hiding selector observed in the production shared booking CSS. */
html:not(.wf-design-mode) [booking-button-wrapper]{display:none}
</style>
<h3>Calls ${ready ? 'available' : 'unavailable'} / authored ${hidden ? 'hidden' : 'visible'}</h3>
<span hidden data-starter-xano-id>383</span><div hidden wf-algolia-index="Freelancers-fixture"></div>
<div id="mixed" class="booking-button-wrapper" booking-button-wrapper ${hidden ? 'style="display:none" aria-hidden="true"' : ''}>
<button id="hire" data-signup-trigger-element="hire" data-modal-trigger="generate-contract">Hire</button>
<button id="book" data-signup-trigger-element="book-call" data-modal-trigger="popup-booking-main">Book Call</button></div>
<dialog data-modal-target="popup-booking-main"></dialog><pre id="result">Waiting…</pre>
<script>
window.MEMBER={};window.memberReady=Promise.resolve(MEMBER);window.waitForMember=cb=>Promise.resolve().then(()=>cb(MEMBER));
window.qs=(s,r)=>(r||document).querySelector(s);window.qsa=(s,r)=>[...(r||document).querySelectorAll(s)];
window.starter_memberstack_id='fixture';window.stripe_charges=false;window.StartersFreeCallBooking={};
window.WfAlgolia={getObject:async()=>({'free-consulting-calls-t-f':${ready},'paid-consulting-calls-t-f':false})};
</script><script>${source.replaceAll('</script', '<\/script')}</script><script>
setTimeout(()=>{
 const mixed=document.getElementById('mixed');
 const visible=id=>document.getElementById(id).getClientRects().length>0;
 const actual={hire:visible('hire'),book:visible('book'),hookRemoved:!mixed.hasAttribute('booking-button-wrapper'),display:mixed.style.display,aria:mixed.getAttribute('aria-hidden')};
 const pass=actual.hire===${!hidden}&&actual.book===${ready && !hidden}&&actual.hookRemoved&&actual.display===${JSON.stringify(hidden ? 'none' : '')}&&actual.aria===${JSON.stringify(hidden ? 'true' : null)};
 document.getElementById('result').textContent=JSON.stringify({pass,...actual},null,2);
 parent.postMessage({fixture:'hire-wrapper-css',caseId:${caseId},pass,actual},'*');
},500);
</script>`;
  return `<iframe id="case-${caseId}" srcdoc="${escape(page)}"></iframe>`;
});
const html = `<!doctype html><title>Hire wrapper CSS regression</title>
<style>body{font:18px Arial;background:#edf0f3;margin:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}iframe{width:100%;height:310px;border:0;background:white}</style>
<h1>Hire / Book Call with production hiding CSS</h1><p>Actual controller; mocked public availability; network disabled in each case.</p><pre id="summary" data-status="pending">Waiting for four cases…</pre>
<script>const results=new Map();addEventListener('message',e=>{const d=e.data;if(d?.fixture!=='hire-wrapper-css'||e.source!==document.getElementById('case-'+d.caseId)?.contentWindow)return;results.set(d.caseId,d);const all=[...results.values()].sort((a,b)=>a.caseId-b.caseId);const summary=document.getElementById('summary');summary.textContent=all.filter(r=>r.pass).length+' / 4 cases passed';summary.dataset.results=JSON.stringify(all);summary.dataset.status=results.size===4?(all.every(r=>r.pass)?'pass':'fail'):'pending';});</script>
<main>${frames.join('')}</main>`;
fs.writeFileSync(output, html);
console.log(JSON.stringify({ output, cases: cases.length }));
