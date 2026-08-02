import { createWorkflowV3Kernel } from "/hestia-browser/workflow-v3-kernel.js";
import { createIdentityPackage, identityCard, restoreIdentityPackage, signIdentityMessage } from "/hestia-browser/recovery-v3.js";
import { combineShares, splitSecret } from "/hestia-browser/shamir.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
let kernel, view, created, shares, recovered, selected = "personal", details = false;
const approvals = new Set();
const evidence = {personal:["Fictional passport","Fictional address statement","Simulated liveness check"],organization:["Fictional board resolution","Fictional employment credential","Fictional signing authority"]};
const esc = (value) => { const node=document.createElement("span"); node.textContent=String(value); return node.innerHTML; };
const phase = (n) => [...document.querySelectorAll(".progress span")].forEach((x,i)=>x.classList.toggle("active",i===n));
const authorities = () => view?.authorities ?? [];
async function dispatch(type,data={}) { const result=await kernel.dispatch(type,data); view=result.view; return result; }

function renderKeys(){
  $("keys").hidden=false; $("keyList").classList.toggle("details",details);
  $("keyList").innerHTML=view.keys.map((k)=>`<article class="card key-card"><span class="status ${/active|saved|distributed/.test(k.status)?"good":""}">${esc(k.status)}</span><h3>${esc(k.name)}</h3><p>${k.id==="identity"?"Signs messages and proves continuity of this identity.":k.id==="factor"?"Your part of every recovery.":"Any two authorities reconstruct their part."}</p><small>${esc(k.kind)} · Secret material hidden</small></article>`).join("");
}
function setupChat(){ $("chat").hidden=false; $("chatAuthority").innerHTML=authorities().map((a)=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join(""); }
function choose(){
  phase(0); screen.innerHTML=`<p class="eyebrow">Choose a story</p><h2>What are you protecting?</h2><p>Everything is fictional and cryptography runs locally in this browser.</p><div class="scenario-grid"><button class="card" data-s="personal"><span class="icon">♙</span><h3>Personal identity</h3><p>A notary, bank, and trusted contact.</p></button><button class="card" data-s="organization"><span class="icon">⌂</span><h3>Organization signer</h3><p>Legal, people, and finance teams.</p></button></div>`;
  screen.querySelectorAll("[data-s]").forEach((button)=>button.onclick=async()=>{selected=button.dataset.s;await dispatch("scenario/select",{scenario:selected});explain();});
}
function explain(){
  screen.innerHTML=`<p class="eyebrow">How it works</p><h2>${esc(view.scenario.title)}</h2><p>One identity signing key is encrypted. A recovery secret is divided among three authorities. Recovery needs <strong>any two authorities plus your private code</strong>.</p><ul class="checklist"><li>Authorities cannot recover by colluding alone.</li><li>Your code is useless without two authorities.</li><li>Private keys and raw shares are never displayed.</li></ul><label>Identity name<input id="identityName" class="code-input" value="${selected==="personal"?"Aurelia Marcellus":"Collegium Viride"}" maxlength="80"></label><div class="actions"><button id="back">Back</button><button id="create" class="primary">Create identity</button></div>`;
  $("back").onclick=choose; $("create").onclick=async()=>{const name=$("identityName").value.trim();if(!name)return;await dispatch("identity/create");created=await createIdentityPackage({name,scenario:selected});await dispatch("identity/created",created.identity);showCode();};
}
function showCode(){
  screen.innerHTML=`<p class="eyebrow">Your private factor</p><h2>Save this recovery code</h2><p>It is shown once. Hestia does not store or send it.</p><div class="code">${esc(created.recoveryCode)}</div><p class="warning">Without this code, even all three authorities cannot unlock your identity.</p><div class="actions"><button id="copy">Copy code</button><button id="saved" class="primary">I have saved it</button></div>`;
  $("copy").onclick=async()=>{await navigator.clipboard.writeText(created.recoveryCode);$("copy").textContent="Copied";}; $("saved").onclick=async()=>{shares=await splitSecret(created.authoritySecret,{shares:3,threshold:2});await dispatch("factor/confirmed");enrolled();};
}
function enrolled(){
  phase(1);renderKeys();setupChat();screen.innerHTML=`<p class="eyebrow">Enrollment complete</p><h2>Three independent guardians protect recovery</h2><div class="authority-grid">${authorities().map((a,i)=>`<article class="card"><span class="status good">Share ${i+1} entrusted</span><h3>${esc(a.name)}</h3><p>Checks: ${esc(evidence[selected][i])}</p></article>`).join("")}</div><p class="fine">No authority has your private key, complete recovery secret, or code.</p><div class="actions"><button id="lose" class="primary">Simulate losing this device</button></div>`;
  $("lose").onclick=async()=>{await dispatch("identity/lost");created.privateKey=null;await dispatch("recovery/start");recovery();};
}
function recovery(){
  phase(2);renderKeys();screen.innerHTML=`<p class="eyebrow">Recovery ceremony</p><h2>Ask two authorities to verify you</h2><p>Click an authority to simulate an independent review of fictional evidence.</p><div class="authority-grid">${authorities().map((a,i)=>`<button class="card authority" data-i="${i}" ${approvals.has(i)?"disabled":""}><span class="status ${approvals.has(i)?"good":""}">${approvals.has(i)?"Approved":"Awaiting review"}</span><h3>${esc(a.name)}</h3><p>${esc(evidence[selected][i])}</p></button>`).join("")}</div><p><strong>${approvals.size} of 2</strong> approvals received.</p>${approvals.size>=2?`<label>Enter your recovery code<input id="codeInput" class="code-input" autocomplete="off" placeholder="xxxx-xxxx-…"></label><div class="actions"><button id="recover" class="primary">Recover identity</button></div>`:""}`;
  screen.querySelectorAll(".authority").forEach((b)=>b.onclick=async()=>{const i=Number(b.dataset.i);approvals.add(i);await dispatch("authority/approved",{authority:authorities()[i].id});recovery();});
  if($("recover")) $("recover").onclick=async()=>{try{const authoritySecret=await combineShares([...approvals].slice(0,2).map((i)=>shares[i]));await dispatch("recovery/code-entered",{});recovered=await restoreIdentityPackage({encryptedPackage:created.encryptedPackage,authoritySecret,recoveryCode:$("codeInput").value});await dispatch("recovery/complete");success();}catch(error){screen.querySelector(".warning")?.remove();screen.insertAdjacentHTML("beforeend",`<p class="warning">${esc(error.message)}</p>`);}};
}
function success(){
  phase(3);renderKeys();$("chatBadge").textContent="Verified identity";screen.innerHTML=`<p class="eyebrow">Identity restored</p><h2>The key is useful again</h2><p>Sign messages so others can verify this recovered identity, and share a public identity card without exposing its private key.</p><dl><dt>Identity</dt><dd>${esc(created.identity.name)}</dd><dt>Public fingerprint</dt><dd class="code">${esc(created.identity.fingerprint)}</dd></dl><div class="actions"><button id="signed" class="primary">Send a signed chat message</button><button id="download">Download public identity card</button></div><p id="signatureResult" class="fine"></p>`;
  $("signed").onclick=async()=>{const message=`I recovered ${created.identity.name}`;const signature=await signIdentityMessage(recovered.privateKey,message);addMessage("You",message,`Verified identity · signature ${signature.slice(0,18)}…`);$("signatureResult").textContent="Signed using the recovered private key.";};
  $("download").onclick=()=>{const blob=new Blob([JSON.stringify(identityCard(created.identity),null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="hestia-identity-card.json";a.click();URL.revokeObjectURL(a.href);};
}
function addMessage(sender,message,proof="Verified device"){$("messages").querySelector(".empty")?.remove();const item=document.createElement("div");item.className="message";for(const [tag,text] of [["strong",sender],["div",message],["small",proof]]){const node=document.createElement(tag);node.textContent=text;item.append(node);}$("messages").append(item);}
$("chatForm").onsubmit=async(event)=>{event.preventDefault();const message=$("chatInput").value.trim();if(!message)return;const authority=authorities().find((a)=>a.id===$("chatAuthority").value);await dispatch("chat/message",{authority:authority.id,message});addMessage(`You → ${authority.name}`,message,recovered?"Verified identity":"Verified device");$("chatInput").value="";setTimeout(()=>addMessage(authority.name,"I received your message. This conversation is session-only."),250);};
$("toggleDetails").onclick=()=>{details=!details;$("toggleDetails").textContent=details?"Hide technical details":"Show technical details";renderKeys();};
try{kernel=await createWorkflowV3Kernel();view=await kernel.view();choose();}catch(error){screen.innerHTML=`<p class="warning">Hestia could not start: ${esc(error.message)}</p>`;console.error(error);}
