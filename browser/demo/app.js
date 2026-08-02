import { createWorkflowV3Kernel } from "/hestia-browser/workflow-v3-kernel.js";
import { createIdentityPackage, identityCard, restoreIdentityPackage, signIdentityMessage } from "/hestia-browser/recovery-v3.js";
import { combineShares, splitSecret } from "/hestia-browser/shamir.js";
import { bytesToBase64Url } from "/hestia-browser/encoding.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
let kernel, view, created, shares, recovered, selected = "personal";
const approvals = new Set();
const evidenceLabel = (authority) => `Fictional ${authority.required[0].replaceAll("-", " ")}`;
const esc = (value) => { const node=document.createElement("span"); node.textContent=String(value); return node.innerHTML; };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const phase = (n) => [...document.querySelectorAll(".progress span")].forEach((x,i)=>x.classList.toggle("active",i===n));
const authorities = () => view?.authorities ?? [];
async function dispatch(type,data={}) { const result=await kernel.dispatch(type,data); view=result.view; return result; }

function renderKeys(){
  $("keys").hidden=false;
  const inventory=view.keys.map((k)=>`<article class="card key-card"><span class="status ${/active|secured|distributed/.test(k.status)?"good":""}">${esc(k.status)}</span><h3>${esc(k.name)}</h3><p>${k.id==="identity"?"Signs messages and proves continuity of this identity.":k.id==="factor"?"Managed automatically by your credential vault.":"Any two chosen authorities reconstruct their part."}</p><small>${esc(k.kind)}</small></article>`).join("");
  if(!created||!shares){$("keyList").innerHTML=inventory;return;}
  const shareCards=shares.map((share,index)=>`<article class="secret-card"><strong>Share ${index+1} → ${esc(authorities()[index].name)}</strong><code>${esc(bytesToBase64Url(share))}</code><small>Production: encrypted to this authority's device key and governed by its own Hara kernel.</small></article>`).join("");
  $("keyList").innerHTML=`${inventory}<article class="transparency"><p class="warning"><strong>Educational transparency mode:</strong> every secret is visible below. These values must never be exposed in a real ceremony.</p><h3>1. Identity key pair</h3><p>The public JWK may be published. The private JWK signs as this identity and would live only inside the encrypted identity package.</p><div class="secret-card"><strong>Public JWK</strong><code>${esc(JSON.stringify(created.identity.public_jwk,null,2))}</code></div><div class="secret-card danger"><strong>Private JWK</strong><code>${esc(JSON.stringify(created.privateJwk,null,2))}</code><small>Production: encrypted with AES-GCM; never rendered or logged.</small></div><h3>2. Two independent recovery ingredients</h3><div class="secret-card danger"><strong>Authority recovery secret</strong><code>${esc(bytesToBase64Url(created.authoritySecret))}</code><small>Immediately split by Hara's Shamir implementation, then erased as a complete value.</small></div><div class="secret-card danger"><strong>Managed user factor</strong><code>${esc(bytesToBase64Url(created.userFactor))}</code><small>Production: derived or released by a synced passkey/credential vault; authorities never receive it.</small></div><h3>3. Hara splits the recovery secret: 2 of 3</h3><p>Each share contains an index plus Shamir data. One share reveals nothing useful; any two reconstruct the authority recovery secret, but still cannot decrypt the identity without the managed factor.</p><div class="share-grid">${shareCards}</div><h3>4. Encrypted identity package</h3><div class="secret-card"><strong>AES-GCM IV</strong><code>${esc(created.encryptedPackage.iv)}</code><strong>Ciphertext + authentication tag</strong><code>${esc(created.encryptedPackage.ciphertext)}</code><small>Production: safe to replicate with authorities because neither shares alone nor the managed factor alone can open it.</small></div></article>`;
}
function setupChat(){ $("chat").hidden=false; $("chatAuthority").innerHTML=authorities().map((a)=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join(""); }
function choose(){
  phase(0); screen.innerHTML=`<p class="eyebrow">Choose a story</p><h2>What are you protecting?</h2><p>Everything is fictional and cryptography runs locally in this browser.</p><div class="scenario-grid"><button class="card" data-s="personal"><span class="icon">♙</span><h3>Personal identity</h3><p>A notary, bank, and trusted contact.</p></button><button class="card" data-s="organization"><span class="icon">⌂</span><h3>Organization signer</h3><p>Legal, people, and finance teams.</p></button></div>`;
  screen.querySelectorAll("[data-s]").forEach((button)=>button.onclick=async()=>{selected=button.dataset.s;await dispatch("scenario/select",{scenario:selected});selectAuthorities();});
}
function selectAuthorities(){
  const chosen=new Set();
  screen.innerHTML=`<p class="eyebrow">Choose your recovery committee</p><h2>Select three authorities</h2><p>Six are available. Choose three to perform independent checks. Any two of your three can approve recovery.</p><p class="fine">In a real deployment, every authority operates its own isolated Hara kernel. This guided page simulates those independent kernels together so you can inspect the whole ceremony.</p><div class="authority-grid">${view.authority_options.map((a)=>`<button class="card authority-option" data-id="${esc(a.id)}"><span class="status">Independent Hara kernel</span><h3>${esc(a.name)}</h3><p>Evidence: ${esc(evidenceLabel(a))}</p></button>`).join("")}</div><p id="selectionCount"><strong>0 of 3</strong> selected.</p><div class="actions"><button id="back">Back</button><button id="continue" class="primary" disabled>Continue with these authorities</button></div>`;
  screen.querySelectorAll(".authority-option").forEach((button)=>button.onclick=()=>{const id=button.dataset.id;if(chosen.has(id)){chosen.delete(id);}else if(chosen.size<3){chosen.add(id);}button.classList.toggle("selected",chosen.has(id));button.querySelector(".status").textContent=chosen.has(id)?"Selected kernel":"Independent Hara kernel";$("selectionCount").innerHTML=`<strong>${chosen.size} of 3</strong> selected.`;$("continue").disabled=chosen.size!==3;});
  $("back").onclick=choose;
  $("continue").onclick=async()=>{const committee=view.authority_options.filter((a)=>chosen.has(a.id));await dispatch("authorities/select",{authorities:committee});explain();};
}
function explain(){
  screen.innerHTML=`<p class="eyebrow">Create the identity</p><h2>${esc(view.scenario.title)}</h2><p>Your identity will be protected by ${authorities().map((a)=>esc(a.name)).join(", ")}, plus an automatically managed credential-vault factor.</p><ul class="checklist"><li>You do not need to copy or save a secret.</li><li>Two authorities alone still cannot unlock the identity.</li><li>This educational demo will display every key, factor, and share after creation.</li></ul><label>Identity name<input id="identityName" class="code-input" value="${selected==="personal"?"Aurelia Marcellus":"Collegium Viride"}" maxlength="80"></label><div class="actions"><button id="back">Change authorities</button><button id="create" class="primary">Create identity</button></div>`;
  $("back").onclick=selectAuthorities;
  $("create").onclick=async()=>{const name=$("identityName").value.trim();if(!name)return;$("create").disabled=true;$("create").textContent="Starting ceremony…";await dispatch("identity/create");created=await createIdentityPackage({name,scenario:selected});await dispatch("identity/created",created.identity);shares=await splitSecret(created.authoritySecret,{shares:authorities().length,threshold:2});await dispatch("factor/secured");await animateEnrollment();enrolled();};
}
function enrollmentSteps(){return [
  ["Browser entropy",`Identity ID: ${created.identity.identity_id}`],
  ["Generate ECDSA P-256 keypair",JSON.stringify(created.identity.public_jwk,null,2)],
  ["Export the private signing key",JSON.stringify(created.privateJwk,null,2)],
  ["Generate 256-bit authority recovery secret",bytesToBase64Url(created.authoritySecret)],
  ["Hara calculates a 2-of-3 Shamir split",`Input secret: ${bytesToBase64Url(created.authoritySecret)}`],
  [`Give share 1 to ${authorities()[0].name}`,bytesToBase64Url(shares[0])],
  [`Give share 2 to ${authorities()[1].name}`,bytesToBase64Url(shares[1])],
  [`Give share 3 to ${authorities()[2].name}`,bytesToBase64Url(shares[2])],
  ["Combine the managed factor with the authority secret",`Factor: ${bytesToBase64Url(created.userFactor)}\nHKDF → AES key: ${bytesToBase64Url(created.packageKeyBytes)}`],
  ["Encrypt the identity package",`IV: ${created.encryptedPackage.iv}\nCiphertext: ${created.encryptedPackage.ciphertext}`]
];}
function renderAnimation(title,subtitle,steps,current){screen.innerHTML=`<p class="eyebrow">Live cryptographic ceremony</p><h2>${esc(title)}</h2><p>${esc(subtitle)}</p><ol class="ceremony-steps">${steps.map(([label,value],index)=>`<li class="${index<current?"done":index===current?"active":"pending"}"><span>${index<current?"✓":index===current?"◆":"○"}</span><div><strong>${esc(label)}</strong>${index<=current?`<code>${esc(value)}</code>`:`<small>Waiting for Hara…</small>`}</div></li>`).join("")}</ol>`;}
async function animateEnrollment(){await dispatch("education/enrollment-start");const steps=enrollmentSteps();for(let index=0;index<steps.length;index++){renderAnimation("Creating and sharing the identity","Hara advances each policy step; browser crypto supplies the calculation.",steps,view.enrollment_step);await wait(1200);if(index<steps.length-1)await dispatch("education/enrollment-next");}}
function enrolled(){
  phase(1);renderKeys();setupChat();screen.innerHTML=`<p class="eyebrow">Enrollment complete</p><h2>Your chosen guardians protect recovery</h2><p class="status good">Credential vault factor secured automatically</p><div class="authority-grid">${authorities().map((a,i)=>`<article class="card"><span class="status good">Share ${i+1} entrusted</span><h3>${esc(a.name)}</h3><p>Checks: ${esc(evidenceLabel(a))}</p></article>`).join("")}</div><p class="fine">No authority has your private key, complete recovery secret, or managed user factor.</p><div class="actions"><button id="lose" class="primary">Simulate losing this device</button></div>`;
  $("lose").onclick=async()=>{await dispatch("identity/lost");created.privateKey=null;await dispatch("recovery/start");recovery();};
}
function recovery(){
  phase(2);renderKeys();screen.innerHTML=`<p class="eyebrow">Recovery ceremony</p><h2>Ask two authorities to verify you</h2><p>Your credential vault factor is supplied automatically. Click an authority to simulate an independent review.</p><div class="authority-grid">${authorities().map((a,i)=>`<button class="card authority" data-i="${i}" ${approvals.has(i)?"disabled":""}><span class="status ${approvals.has(i)?"good":""}">${approvals.has(i)?"Approved":"Awaiting review"}</span><h3>${esc(a.name)}</h3><p>${esc(evidenceLabel(a))}</p></button>`).join("")}</div><p><strong>${approvals.size} of 2</strong> approvals received.</p>${approvals.size>=2?`<div class="actions"><button id="recover" class="primary">Recover with credential vault</button></div>`:""}`;
  screen.querySelectorAll(".authority").forEach((b)=>b.onclick=async()=>{const i=Number(b.dataset.i);approvals.add(i);await dispatch("authority/approved",{authority:authorities()[i].id});recovery();});
  if($("recover")) $("recover").onclick=async()=>{try{const chosenIndexes=[...approvals].slice(0,2);const authoritySecret=await combineShares(chosenIndexes.map((i)=>shares[i]));await dispatch("recovery/code-entered",{});recovered=await restoreIdentityPackage({encryptedPackage:created.encryptedPackage,authoritySecret,userFactor:created.userFactor});const proof=await signIdentityMessage(recovered.privateKey,`Recovered ${created.identity.identity_id}`);await animateRecovery(chosenIndexes,authoritySecret,proof);await dispatch("recovery/complete");success();}catch(error){screen.querySelector(".warning")?.remove();screen.insertAdjacentHTML("beforeend",`<p class="warning">${esc(error.message)}</p>`);}};
}
function recoverySteps(indexes,authoritySecret,proof){return [
  ["Start recovery",`Encrypted package: ${created.encryptedPackage.ciphertext}`],
  [`Receive approved share from ${authorities()[indexes[0]].name}`,bytesToBase64Url(shares[indexes[0]])],
  [`Receive approved share from ${authorities()[indexes[1]].name}`,bytesToBase64Url(shares[indexes[1]])],
  ["Hara reconstructs the authority recovery secret",bytesToBase64Url(authoritySecret)],
  ["Credential vault supplies the managed factor",bytesToBase64Url(created.userFactor)],
  ["HKDF reproduces the AES package key",`${bytesToBase64Url(recovered.packageKeyBytes)}\nMatches enrollment: ${bytesToBase64Url(recovered.packageKeyBytes)===bytesToBase64Url(created.packageKeyBytes)}`],
  ["AES-GCM decrypts and imports the private JWK",JSON.stringify(recovered.data.private_jwk,null,2)],
  ["Recovered identity signs a proof",proof]
];}
async function animateRecovery(indexes,authoritySecret,proof){await dispatch("education/recovery-start");const steps=recoverySteps(indexes,authoritySecret,proof);for(let index=0;index<steps.length;index++){renderAnimation("Reconstructing the identity","The recovery ceremony repeats the derivation in reverse, with every value visible.",steps,view.recovery_step);await wait(1200);if(index<steps.length-1)await dispatch("education/recovery-next");}}
function success(){
  phase(3);renderKeys();$("chatBadge").textContent="Verified identity";screen.innerHTML=`<p class="eyebrow">Identity restored</p><h2>The key is useful again</h2><p>Sign messages so others can verify this recovered identity, and share a public identity card without exposing its private key.</p><dl><dt>Identity</dt><dd>${esc(created.identity.name)}</dd><dt>Public fingerprint</dt><dd class="code">${esc(created.identity.fingerprint)}</dd></dl><div class="actions"><button id="signed" class="primary">Send a signed chat message</button><button id="download">Download public identity card</button></div><p id="signatureResult" class="fine"></p>`;
  $("signed").onclick=async()=>{const message=`I recovered ${created.identity.name}`;const signature=await signIdentityMessage(recovered.privateKey,message);addMessage("You",message,`Verified identity · signature ${signature.slice(0,18)}…`);$("signatureResult").textContent="Signed using the recovered private key.";};
  $("download").onclick=()=>{const blob=new Blob([JSON.stringify(identityCard(created.identity),null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="hestia-identity-card.json";a.click();URL.revokeObjectURL(a.href);};
}
function addMessage(sender,message,proof="Verified device"){$("messages").querySelector(".empty")?.remove();const item=document.createElement("div");item.className="message";for(const [tag,text] of [["strong",sender],["div",message],["small",proof]]){const node=document.createElement(tag);node.textContent=text;item.append(node);}$("messages").append(item);}
$("chatForm").onsubmit=async(event)=>{event.preventDefault();const message=$("chatInput").value.trim();if(!message)return;const authority=authorities().find((a)=>a.id===$("chatAuthority").value);await dispatch("chat/message",{authority:authority.id,message});addMessage(`You → ${authority.name}`,message,recovered?"Verified identity":"Verified device");$("chatInput").value="";setTimeout(()=>addMessage(authority.name,"I received your message. This conversation is session-only."),250);};
try{kernel=await createWorkflowV3Kernel();view=await kernel.view();choose();}catch(error){screen.innerHTML=`<p class="warning">Hestia could not start: ${esc(error.message)}</p>`;console.error(error);}
