import { createWorkflowV3Kernel } from "/hestia-browser/workflow-v3-kernel.js";
import { createIdentityPackage, identityCard, restoreIdentityPackage, signIdentityMessage } from "/hestia-browser/recovery-v3.js";
import { combineShares, splitSecret } from "/hestia-browser/shamir.js";
import { bytesToBase64Url } from "/hestia-browser/encoding.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
const approvals = new Set();
let kernel, view, created, shares, recovered;
let identityName = "Alex Morgan";

const authorityLabels = {
  notary: "Professional registration",
  bank: "Community bank",
  contact: "Trusted person",
  solicitor: "Legal representative",
  employer: "Employer identity team",
  civic: "Government identity service"
};

const evidenceLabels = {
  notary: "Registration record",
  bank: "Verified account",
  contact: "Live confirmation",
  solicitor: "Identity record",
  employer: "Employment record",
  civic: "Government identity record"
};

const esc = (value) => {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const phase = (index) => [...document.querySelectorAll(".progress span")].forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === index));
const authorities = () => view?.authorities ?? [];
const authorityName = (authority) => authorityLabels[authority.id] ?? authority.name;
const evidenceLabel = (authority) => evidenceLabels[authority.id] ?? authority.required?.[0]?.replaceAll("-", " ") ?? "Independent evidence";
async function dispatch(type, data = {}) { const result = await kernel.dispatch(type, data); view = result.view; return result; }

function header(label, title, description = "") {
  return `<header class="screen-head"><div><p class="eyebrow">${esc(label)}</p><h2>${esc(title)}</h2></div>${description ? `<p>${esc(description)}</p>` : ""}</header>`;
}

function renderKeys() {
  $("technical").hidden = false;
  $("keys").hidden = false;
  const inventory = view.keys.map((key) => `<article class="card key-card"><span class="status ${/active|secured|distributed/.test(key.status) ? "good" : ""}">${esc(key.status.replaceAll("-", " "))}</span><h3>${esc(key.name.replace("Credential vault", "Device-secured"))}</h3><p>${key.id === "identity" ? "Signs messages and maintains identity continuity." : key.id === "factor" ? "Held separately from the recovery authorities." : "Any two selected authorities can reconstruct their part."}</p></article>`).join("");
  if (!created || !shares) { $("keyList").innerHTML = inventory; return; }
  const shareCards = shares.map((share, index) => `<article class="secret-card"><strong>Share ${index + 1} · ${esc(authorityName(authorities()[index]))}</strong><code>${esc(bytesToBase64Url(share))}</code><small>Encrypted for this authority in a production deployment.</small></article>`).join("");
  $("keyList").innerHTML = `${inventory}<details class="raw-values"><summary>Show demo cryptographic values</summary><div class="raw-content"><p class="warning"><strong>Demo transparency:</strong> these values are displayed only for education. Production software must never render secret material.</p><article class="secret-card"><strong>Public identity key</strong><code>${esc(JSON.stringify(created.identity.public_jwk, null, 2))}</code></article><article class="secret-card"><strong>Private identity key</strong><code>${esc(JSON.stringify(created.privateJwk, null, 2))}</code><small>Production: encrypted locally and never rendered or logged.</small></article><article class="secret-card"><strong>Authority recovery secret</strong><code>${esc(bytesToBase64Url(created.authoritySecret))}</code></article><article class="secret-card"><strong>Device-secured factor</strong><code>${esc(bytesToBase64Url(created.userFactor))}</code><small>Recovery authorities never receive this factor.</small></article><div class="share-grid">${shareCards}</div><article class="secret-card"><strong>Encrypted identity package</strong><code>${esc(created.encryptedPackage.ciphertext)}</code><small>AES-GCM ciphertext and authentication tag.</small></article></div></details>`;
}

function setupChat() {
  $("chat").hidden = false;
  $("chatAuthority").innerHTML = authorities().map((authority) => `<option value="${esc(authority.id)}">${esc(authorityName(authority))}</option>`).join("");
}

function setup() {
  phase(0);
  approvals.clear();
  screen.innerHTML = `${header("Step 1 of 5", "Set up a demo identity", "This reusable example follows a fictional professional. No personal or health information is collected.")}<div class="persona"><span class="persona-icon">AM</span><div><strong>Alex Morgan</strong><small>Health-sector professional · fictional profile</small></div></div><label class="field">Identity name<input id="identityName" value="${esc(identityName)}" maxlength="80"></label><div class="actions"><button id="begin" class="primary">Choose recovery authorities</button></div>`;
  $("begin").onclick = () => { identityName = $("identityName").value.trim() || "Alex Morgan"; selectAuthorities(); };
}

function selectAuthorities() {
  const chosen = new Set();
  screen.innerHTML = `${header("Step 1 of 5", "Choose three independent authorities", "Select three organizations or people that can evaluate a future recovery request. Any two can approve.")}<div class="authority-grid">${view.authority_options.map((authority) => `<button class="card authority-option" data-id="${esc(authority.id)}"><span class="status">Available</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></button>`).join("")}</div><div class="selection-row"><p id="selectionCount"><strong>0 of 3</strong> selected</p><div class="actions"><button id="back">Back</button><button id="continue" class="primary" disabled>Review protection</button></div></div>`;
  screen.querySelectorAll(".authority-option").forEach((button) => button.onclick = () => {
    const id = button.dataset.id;
    if (chosen.has(id)) chosen.delete(id); else if (chosen.size < 3) chosen.add(id);
    button.classList.toggle("selected", chosen.has(id));
    button.querySelector(".status").textContent = chosen.has(id) ? "Selected" : "Available";
    $("selectionCount").innerHTML = `<strong>${chosen.size} of 3</strong> selected`;
    $("continue").disabled = chosen.size !== 3;
  });
  $("back").onclick = setup;
  $("continue").onclick = async () => {
    const committee = view.authority_options.filter((authority) => chosen.has(authority.id));
    await dispatch("authorities/select", { authorities: committee });
    reviewProtection();
  };
}

function reviewProtection() {
  screen.innerHTML = `${header("Step 1 of 5", "Review the protection model", "The identity will require two authority shares and the separately held device factor.")}<div class="authority-grid">${authorities().map((authority) => `<article class="card"><span class="status good">Selected</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></article>`).join("")}</div><div class="success-callout"><span class="callout-icon">2+1</span><div><strong>Neither side is sufficient alone</strong><p>Two authorities cannot restore the identity without the device-secured factor.</p></div></div><div class="actions"><button id="back">Change authorities</button><button id="create" class="primary">Create demo identity</button></div>`;
  $("back").onclick = selectAuthorities;
  $("create").onclick = async () => {
    $("create").disabled = true;
    $("create").textContent = "Creating identity…";
    await dispatch("identity/create");
    created = await createIdentityPackage({ name: identityName, scenario: "personal" });
    await dispatch("identity/created", created.identity);
    shares = await splitSecret(created.authoritySecret, { shares: authorities().length, threshold: 2 });
    await dispatch("factor/secured");
    await animateEnrollment();
    protectedIdentity();
  };
}

function enrollmentSteps() { return ["Generate the identity key", "Create an encrypted recovery package", "Split the recovery secret into three shares", "Send one share to each authority", "Secure the separate device factor"]; }
function recoverySteps() { return ["Receive two approved shares", "Reconstruct the authority secret", "Add the device-secured factor", "Decrypt the identity package", "Verify the restored signing key"]; }

function renderProcess(label, title, steps, current) {
  screen.innerHTML = `${header(label, title, "The real cryptographic operations run locally. Raw values remain in Technical details.")}<ol class="process-steps">${steps.map((step, index) => `<li class="${index < current ? "done" : index === current ? "active" : "pending"}"><span>${index < current ? "✓" : index === current ? "●" : "○"}</span><strong>${esc(step)}</strong></li>`).join("")}</ol>`;
}

async function animateEnrollment() {
  await dispatch("education/enrollment-start");
  const steps = enrollmentSteps();
  for (let index = 0; index < steps.length; index += 1) {
    renderProcess("Step 2 of 5", "Protecting the identity", steps, index);
    await wait(450);
    if (index < steps.length - 1) await dispatch("education/enrollment-next");
  }
}

function protectedIdentity() {
  phase(1);
  renderKeys();
  setupChat();
  screen.innerHTML = `${header("Step 2 of 5", "Identity protection is active", "Each authority holds one encrypted share. The separate factor remains outside their control.")}<div class="success-callout"><span class="callout-icon">✓</span><div><strong>2-of-3 protection configured</strong><p>No single authority has enough information to restore the identity.</p></div></div><div class="authority-grid">${authorities().map((authority, index) => `<article class="card"><span class="status good">Share ${index + 1} secured</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></article>`).join("")}</div><div class="actions"><button id="lose" class="primary">Simulate a lost device</button></div>`;
  $("lose").onclick = async () => { await dispatch("identity/lost"); created.privateKey = null; showLoss(); };
}

function showLoss() {
  phase(2);
  renderKeys();
  screen.innerHTML = `${header("Step 3 of 5", "This device no longer has access", "The active key is unavailable, but the encrypted package and distributed recovery shares remain protected.")}<div class="loss-callout"><span class="callout-icon">!</span><div><strong>Identity access unavailable</strong><p>No authority can restore access independently.</p></div></div><div class="actions"><button id="recoverStart" class="primary">Start recovery</button></div>`;
  $("recoverStart").onclick = async () => { await dispatch("recovery/start"); recovery(); };
}

function recovery() {
  phase(3);
  renderKeys();
  screen.innerHTML = `${header("Step 4 of 5", "Request two independent approvals", "Select two authorities to simulate separate evidence checks and share-release decisions.")}<div class="authority-grid">${authorities().map((authority, index) => `<button class="card authority" data-index="${index}" ${approvals.has(index) ? "disabled" : ""}><span class="status ${approvals.has(index) ? "good" : ""}">${approvals.has(index) ? "Approved" : "Review request"}</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></button>`).join("")}</div><div class="selection-row"><p><strong>${approvals.size} of 2</strong> approvals received</p>${approvals.size >= 2 ? `<button id="restore" class="primary">Restore identity</button>` : ""}</div>`;
  screen.querySelectorAll(".authority").forEach((button) => button.onclick = async () => { const index = Number(button.dataset.index); approvals.add(index); await dispatch("authority/approved", { authority: authorities()[index].id }); recovery(); });
  if ($("restore")) $("restore").onclick = restore;
}

async function restore() {
  try {
    const indexes = [...approvals].slice(0, 2);
    const authoritySecret = await combineShares(indexes.map((index) => shares[index]));
    await dispatch("recovery/code-entered", {});
    recovered = await restoreIdentityPackage({ encryptedPackage: created.encryptedPackage, authoritySecret, userFactor: created.userFactor });
    await animateRecovery();
    await dispatch("recovery/complete");
    success();
  } catch (error) {
    screen.insertAdjacentHTML("beforeend", `<p class="warning">${esc(error.message)}</p>`);
  }
}

async function animateRecovery() {
  await dispatch("education/recovery-start");
  const steps = recoverySteps();
  for (let index = 0; index < steps.length; index += 1) {
    renderProcess("Step 5 of 5", "Restoring the identity", steps, index);
    await wait(450);
    if (index < steps.length - 1) await dispatch("education/recovery-next");
  }
}

function success() {
  phase(4);
  renderKeys();
  $("chatBadge").textContent = "Verified identity";
  screen.innerHTML = `${header("Step 5 of 5", "Identity restored", "The recovered key can sign again, proving continuity with the original public identity.")}<div class="success-callout"><span class="callout-icon">✓</span><div><strong>Recovery complete</strong><p>Two approvals and the device-secured factor reproduced the original key.</p></div></div><dl><dt>Identity</dt><dd>${esc(created.identity.name)}</dd><dt>Public fingerprint</dt><dd class="code">${esc(created.identity.fingerprint)}</dd></dl><div class="actions"><button id="signed" class="primary">Send a signed demo message</button><button id="download">Download public identity card</button></div><p id="signatureResult" class="fine"></p>`;
  $("signed").onclick = async () => { const message = `I recovered ${created.identity.name}`; const signature = await signIdentityMessage(recovered.privateKey, message); addMessage("You", message, `Verified identity · signature ${signature.slice(0, 18)}…`); $("signatureResult").textContent = "Signed with the restored private key. See Technical details for the authority message."; };
  $("download").onclick = () => { const blob = new Blob([JSON.stringify(identityCard(created.identity), null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "hestia-identity-card.json"; link.click(); URL.revokeObjectURL(link.href); };
}

function addMessage(sender, message, proof = "Verified device") {
  $("messages").querySelector(".empty")?.remove();
  const item = document.createElement("div");
  item.className = "message";
  for (const [tag, text] of [["strong", sender], ["div", message], ["small", proof]]) { const node = document.createElement(tag); node.textContent = text; item.append(node); }
  $("messages").append(item);
}

$("chatForm").onsubmit = async (event) => {
  event.preventDefault();
  const message = $("chatInput").value.trim();
  if (!message) return;
  const authority = authorities().find((item) => item.id === $("chatAuthority").value);
  await dispatch("chat/message", { authority: authority.id, message });
  addMessage(`You → ${authorityName(authority)}`, message, recovered ? "Verified identity" : "Verified device");
  $("chatInput").value = "";
  setTimeout(() => addMessage(authorityName(authority), "Message received. This conversation is session-only."), 250);
};

try {
  kernel = await createWorkflowV3Kernel();
  view = await kernel.view();
  await dispatch("scenario/select", { scenario: "personal" });
  setup();
} catch (error) {
  screen.innerHTML = `<p class="warning">Hestia could not start: ${esc(error.message)}</p>`;
  console.error(error);
}
