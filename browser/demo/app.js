import { createWorkflowV3Kernel } from "../hestia-browser/workflow-v3-kernel.js";
import { createIdentityPackage, identityCard, restoreIdentityPackage, signIdentityMessage } from "../hestia-browser/recovery-v3.js";
import { combineShares, splitSecret } from "../hestia-browser/shamir.js";
import { bytesToBase64Url } from "../hestia-browser/encoding.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
const approvals = new Set();
let kernel, view, created, shares, recovered, program;
let identityName = "My Private Agent Office";

const storyScenes = [
  { src: "../assets/hestia-greyhound-day.webp", alt: "A quiet private office prepared for its owner and agents" },
  { src: "../assets/hestia-recovery-keepers.webp", alt: "Three independent sanctuary chambers arranged around a shared continuity point" },
  { src: "../assets/hestia-greyhound-night.webp", alt: "A private office at rest while its active key is unavailable" },
  { src: "../assets/hestia-recovery-keepers.webp", alt: "Independent stewards returning their approvals to the continuity ceremony" },
  { src: "../assets/hestia-local-ledger.webp", alt: "An ember-lit private office ledger restored with a continuous signed history" }
];

const authorityLabels = {
  notary: "Independent Notary",
  bank: "Private Banking Contact",
  contact: "Trusted Steward",
  solicitor: "Family Solicitor",
  employer: "Professional Adviser",
  civic: "Civic Registry"
};

const evidenceLabels = {
  notary: "Independent identity record",
  bank: "Verified private relationship",
  contact: "Live personal confirmation",
  solicitor: "Continuity mandate",
  employer: "Current professional engagement",
  civic: "Civil identity record"
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

function kernelStatus(label, detail, kind = "loading") {
  const card = $("kernelLight")?.closest(".kernel-card");
  card?.classList.toggle("ready", kind === "ready");
  card?.classList.toggle("error", kind === "error");
  if ($("kernelState")) $("kernelState").textContent = label;
  if ($("kernelDetail")) $("kernelDetail").textContent = detail;
}

async function dispatch(type, data = {}) {
  const result = await kernel.dispatch(type, data);
  view = result.view;
  kernelStatus(
    program?.title ?? "Hestia continuity program",
    `${type} accepted locally · ${result.commands.length} capability command${result.commands.length === 1 ? "" : "s"}`,
    "ready"
  );
  return result;
}

function header(label, title, description = "") {
  return `<header class="screen-head"><div><p class="eyebrow">${esc(label)}</p><h2>${esc(title)}</h2></div>${description ? `<p>${esc(description)}</p>` : ""}</header>`;
}

function screenView(stage, content) {
  const scene = storyScenes[stage];
  return `<div class="demo-scene"><figure><img src="${scene.src}" alt="${esc(scene.alt)}"></figure><div class="demo-screen-body">${content}</div></div>`;
}

function renderKeys() {
  $("technical").hidden = false;
  $("keys").hidden = false;
  const inventory = view.keys.map((key) => `<article class="card key-card"><span class="status ${/active|secured|distributed/.test(key.status) ? "good" : ""}">${esc(key.status.replaceAll("-", " "))}</span><h3>${esc(key.name)}</h3><p>${key.id === "identity" ? "Signs agent-office records and maintains continuity across a restoration." : key.id === "factor" ? "Remains with the owner and outside every steward's custody." : "Any two appointed stewards can reconstruct their part, but not the office by themselves."}</p></article>`).join("");
  if (!created || !shares) {
    $("keyList").innerHTML = inventory;
    return;
  }
  const shareCards = shares.map((share, index) => `<article class="secret-card"><strong>Steward share ${index + 1} · ${esc(authorityName(authorities()[index]))}</strong><code>${esc(bytesToBase64Url(share))}</code><small>In a production arrangement this share is encrypted for, and released by, that steward alone.</small></article>`).join("");
  $("keyList").innerHTML = `${inventory}<details class="raw-values"><summary>Show demonstration cryptographic values</summary><div class="raw-content"><p class="warning"><strong>Demonstration transparency:</strong> these values are displayed only to make the mechanism inspectable. A production office must never render or log its secret material.</p><article class="secret-card"><strong>Public office key</strong><code>${esc(JSON.stringify(created.identity.public_jwk, null, 2))}</code></article><article class="secret-card"><strong>Private office key</strong><code>${esc(JSON.stringify(created.privateJwk, null, 2))}</code><small>Production: encrypted locally and never rendered or logged.</small></article><article class="secret-card"><strong>Steward recovery secret</strong><code>${esc(bytesToBase64Url(created.authoritySecret))}</code></article><article class="secret-card"><strong>Owner-held continuity factor</strong><code>${esc(bytesToBase64Url(created.userFactor))}</code><small>The appointed stewards never receive this factor.</small></article><div class="share-grid">${shareCards}</div><article class="secret-card"><strong>Encrypted private-office package</strong><code>${esc(created.encryptedPackage.ciphertext)}</code><small>AES-GCM ciphertext and authentication tag.</small></article></div></details>`;
}

function generationSecrets() {
  if (!created || !shares) return "";
  const shareCards = shares.map((share, index) => `<article class="secret-card"><strong>Steward share ${index + 1} · ${esc(authorityName(authorities()[index]))}</strong><code>${esc(bytesToBase64Url(share))}</code></article>`).join("");
  return `<details class="secrets-accordion"><summary><span><strong><span class="show-secrets">Show continuity material</span><span class="hide-secrets">Hide continuity material</span></strong><small>Inspect what was generated while arranging this private office</small></span><i aria-hidden="true"></i></summary><div class="secrets-content"><p class="warning"><strong>Demonstration transparency:</strong> production software must never render secret material.</p><div class="secrets-grid"><article class="secret-card"><strong>Private office key</strong><code>${esc(JSON.stringify(created.privateJwk, null, 2))}</code></article><article class="secret-card"><strong>Steward recovery secret</strong><code>${esc(bytesToBase64Url(created.authoritySecret))}</code></article><article class="secret-card"><strong>Owner-held continuity factor</strong><code>${esc(bytesToBase64Url(created.userFactor))}</code></article></div><div class="share-grid">${shareCards}</div></div></details>`;
}

function setupChat() {
  $("chat").hidden = false;
  $("chatAuthority").innerHTML = authorities().map((authority) => `<option value="${esc(authority.id)}">${esc(authorityName(authority))}</option>`).join("");
}

function setup() {
  phase(0);
  approvals.clear();
  screen.innerHTML = screenView(0, `${header("Step 1 of 5", "Name the office you are protecting", "This demonstration creates a local signing identity for a private agent office. It does not collect or submit personal information.")}<div class="persona"><span class="persona-icon" aria-hidden="true">H</span><div><strong>Private office continuity</strong><small>Owner-controlled · local demonstration</small></div></div><label class="field">Private office name<input id="identityName" value="${esc(identityName)}" maxlength="80"></label><div class="actions"><button id="begin" class="primary">Choose continuity stewards</button></div>`);
  $("begin").onclick = () => {
    identityName = $("identityName").value.trim() || "My Private Agent Office";
    selectAuthorities();
  };
}

function selectAuthorities() {
  const chosen = new Set();
  screen.innerHTML = screenView(1, `${header("Step 1 of 5", "Choose three independent stewards", "Each steward represents a person or institution that can evaluate a future continuity request. Any two may approve, but the owner's separate factor is still required.")}<div class="authority-grid">${view.authority_options.map((authority) => `<button class="card authority-option" data-id="${esc(authority.id)}"><span class="status">Available</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></button>`).join("")}</div><div class="selection-row"><p id="selectionCount"><strong>0 of 3</strong> appointed</p><div class="actions"><button id="back">Back</button><button id="continue" class="primary" disabled>Review the arrangement</button></div></div>`);
  screen.querySelectorAll(".authority-option").forEach((button) => button.onclick = () => {
    const id = button.dataset.id;
    if (chosen.has(id)) chosen.delete(id); else if (chosen.size < 3) chosen.add(id);
    button.classList.toggle("selected", chosen.has(id));
    button.querySelector(".status").textContent = chosen.has(id) ? "Appointed" : "Available";
    $("selectionCount").innerHTML = `<strong>${chosen.size} of 3</strong> appointed`;
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
  screen.innerHTML = screenView(1, `${header("Step 1 of 5", "Review the continuity arrangement", "Restoration will require two independently released steward shares and the factor that remains with the office owner.")}<div class="authority-grid">${authorities().map((authority) => `<article class="card"><span class="status good">Appointed steward</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></article>`).join("")}</div><div class="success-callout"><span class="callout-icon">2+1</span><div><strong>Shared responsibility, private control</strong><p>Two stewards cannot restore the office without the owner-held continuity factor.</p></div></div><div class="actions"><button id="back">Change stewards</button><button id="create" class="primary">Seal the continuity plan</button></div>`);
  $("back").onclick = selectAuthorities;
  $("create").onclick = async () => {
    $("create").disabled = true;
    $("create").textContent = "Sealing the plan…";
    await dispatch("identity/create");
    created = await createIdentityPackage({ name: identityName, scenario: "personal" });
    await dispatch("identity/created", created.identity);
    shares = await splitSecret(created.authoritySecret, { shares: authorities().length, threshold: 2 });
    await dispatch("factor/secured");
    await animateEnrollment();
    protectedIdentity();
  };
}

function enrollmentSteps() {
  return [
    "Create the private office signing key",
    "Seal an encrypted continuity package",
    "Split the steward secret into three shares",
    "Assign one protected share to each steward",
    "Secure the separate owner-held factor"
  ];
}

function recoverySteps() {
  return [
    "Receive two approved steward shares",
    "Reconstruct the steward secret",
    "Add the owner-held continuity factor",
    "Open the encrypted private-office package",
    "Verify continuity with the original public key"
  ];
}

function renderProcess(label, title, steps, current) {
  const stage = /Restoring/.test(title) ? 4 : 1;
  screen.innerHTML = screenView(stage, `${header(label, title, "The cryptographic operations run locally. The complete Hara program and demonstration values remain available in Continuity record and live HAL.")}<ol class="process-steps">${steps.map((step, index) => `<li class="${index < current ? "done" : index === current ? "active" : "pending"}"><span>${index < current ? "✓" : index === current ? "●" : "○"}</span><strong>${esc(step)}</strong></li>`).join("")}</ol>`);
}

async function animateEnrollment() {
  await dispatch("education/enrollment-start");
  const steps = enrollmentSteps();
  for (let index = 0; index < steps.length; index += 1) {
    renderProcess("Step 2 of 5", "Sealing the continuity plan", steps, index);
    await wait(350);
    if (index < steps.length - 1) await dispatch("education/enrollment-next");
  }
}

function protectedIdentity() {
  phase(1);
  renderKeys();
  setupChat();
  screen.innerHTML = screenView(1, `${header("Step 2 of 5", "Your continuity plan is sealed", "Each appointed steward holds one protected share. The owner-held factor remains outside their control.")}<div class="success-callout"><span class="callout-icon">✓</span><div><strong>2-of-3 stewardship arranged</strong><p>No single steward, coordinator or hosted service has enough information to restore the private office.</p></div></div><div class="authority-grid">${authorities().map((authority, index) => `<article class="card"><span class="status good">Share ${index + 1} appointed</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></article>`).join("")}</div>${generationSecrets()}<div class="actions"><button id="lose" class="primary">Simulate an unavailable office key</button></div>`);
  $("lose").onclick = async () => {
    await dispatch("identity/lost");
    created.privateKey = null;
    showLoss();
  };
}

function showLoss() {
  phase(2);
  renderKeys();
  screen.innerHTML = screenView(2, `${header("Step 3 of 5", "The office key is unavailable", "The active device or key can no longer be used, while the encrypted office package and steward arrangement remain intact.")}<div class="loss-callout"><span class="callout-icon">!</span><div><strong>Daily access has been interrupted</strong><p>The owner still holds the separate continuity factor, and no steward can restore the office independently.</p></div></div><div class="actions"><button id="recoverStart" class="primary">Ask the stewards</button></div>`);
  $("recoverStart").onclick = async () => {
    await dispatch("recovery/start");
    recovery();
  };
}

function recovery() {
  phase(3);
  renderKeys();
  screen.innerHTML = screenView(3, `${header("Step 4 of 5", "Request two independent approvals", "Choose two appointed stewards to simulate separate evidence checks and share-release decisions.")}<div class="authority-grid">${authorities().map((authority, index) => `<button class="card authority" data-index="${index}" ${approvals.has(index) ? "disabled" : ""}><span class="status ${approvals.has(index) ? "good" : ""}">${approvals.has(index) ? "Approved" : "Review request"}</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></button>`).join("")}</div><div class="selection-row"><p><strong>${approvals.size} of 2</strong> approvals received</p>${approvals.size >= 2 ? `<button id="restore" class="primary">Restore the private office</button>` : ""}</div>`);
  screen.querySelectorAll(".authority").forEach((button) => button.onclick = async () => {
    const index = Number(button.dataset.index);
    approvals.add(index);
    await dispatch("authority/approved", { authority: authorities()[index].id });
    recovery();
  });
  if ($("restore")) $("restore").onclick = restore;
}

async function restore() {
  try {
    const indexes = [...approvals].slice(0, 2);
    const authoritySecret = await combineShares(indexes.map((index) => shares[index]));
    await dispatch("recovery/code-entered", {});
    recovered = await restoreIdentityPackage({
      encryptedPackage: created.encryptedPackage,
      authoritySecret,
      userFactor: created.userFactor
    });
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
    renderProcess("Step 5 of 5", "Restoring the private office", steps, index);
    await wait(350);
    if (index < steps.length - 1) await dispatch("education/recovery-next");
  }
}

function success() {
  phase(4);
  renderKeys();
  $("chatBadge").textContent = "Verified office";
  screen.innerHTML = screenView(4, `${header("Step 5 of 5", "The private office is restored", "The recovered key can sign again, proving continuity with the original public office identity.")}<div class="success-callout"><span class="callout-icon">✓</span><div><strong>Continuity verified</strong><p>Two independent approvals and the owner-held factor reproduced the original signing key locally.</p></div></div><dl><dt>Private office</dt><dd>${esc(created.identity.name)}</dd><dt>Public fingerprint</dt><dd class="code">${esc(created.identity.fingerprint)}</dd></dl><div class="actions"><button id="signed" class="primary">Sign a continuity proof</button><button id="download">Download public office card</button></div><p id="signatureResult" class="fine"></p><nav class="end-nav" aria-label="Continuity demo navigation"><button id="reviewBack">Back</button><button id="restart">Restart</button></nav>`);
  $("signed").onclick = async () => {
    const message = `Continuity restored for ${created.identity.name}`;
    const signature = await signIdentityMessage(recovered.privateKey, message);
    addMessage("Private office", message, `Verified continuity · signature ${signature.slice(0, 18)}…`);
    $("signatureResult").textContent = "Signed with the restored private key. The steward coordination record is available below.";
  };
  $("download").onclick = () => {
    const blob = new Blob([JSON.stringify(identityCard(created.identity), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "hestia-private-office-card.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  $("reviewBack").onclick = reviewApprovals;
  $("restart").onclick = () => window.location.reload();
}

function reviewApprovals() {
  phase(3);
  screen.innerHTML = screenView(3, `${header("Step 4 of 5", "Two stewards approved continuity", "This is a visual review. The completed cryptographic state remains unchanged.")}<div class="authority-grid">${authorities().map((authority, index) => `<article class="card"><span class="status ${approvals.has(index) ? "good" : ""}">${approvals.has(index) ? "Approved" : "Not requested"}</span><h3>${esc(authorityName(authority))}</h3><p>${esc(evidenceLabel(authority))}</p></article>`).join("")}</div><div class="selection-row"><p><strong>${approvals.size} of 2</strong> approvals received</p><button id="reviewForward" class="primary">Return to the restored office</button></div>`);
  $("reviewForward").onclick = success;
}

function addMessage(sender, message, proof = "Verified office device") {
  $("messages").querySelector(".empty")?.remove();
  const item = document.createElement("div");
  item.className = "message";
  for (const [tag, text] of [["strong", sender], ["div", message], ["small", proof]]) {
    const node = document.createElement(tag);
    node.textContent = text;
    item.append(node);
  }
  $("messages").append(item);
}

$("chatForm").onsubmit = async (event) => {
  event.preventDefault();
  const message = $("chatInput").value.trim();
  if (!message) return;
  const authority = authorities().find((item) => item.id === $("chatAuthority").value);
  await dispatch("chat/message", { authority: authority.id, message });
  addMessage(`Private office → ${authorityName(authority)}`, message, recovered ? "Verified restored office" : "Verified office device");
  $("chatInput").value = "";
  setTimeout(() => addMessage(authorityName(authority), "Message received. This coordination conversation remains in the current browser session."), 250);
};

async function initialise() {
  kernelStatus("Opening the continuity desk…", "Loading the Hara/WASM recovery program.");
  $("retryKernel").hidden = true;
  kernel = await createWorkflowV3Kernel();
  program = await kernel.program();
  $("halProgramName").textContent = program.namespace;
  $("halProgramVersion").textContent = program.version;
  $("halEventCount").textContent = String(program.events.length);
  $("halSource").textContent = program.source;
  view = await kernel.view();
  await dispatch("scenario/select", { scenario: "personal" });
  setup();
  kernelStatus(
    program.title,
    `${program.events.length} continuity transitions are ready in this browser.`,
    "ready"
  );
  globalThis.__HESTIA_CONTINUITY_READY__ = true;
}

$("retryKernel").onclick = () => window.location.reload();

initialise().catch((error) => {
  const message = error?.message ?? String(error);
  screen.innerHTML = `<p class="warning"><strong>Hestia continuity could not start.</strong><br>${esc(message)}</p>`;
  kernelStatus("Continuity program unavailable", message, "error");
  $("retryKernel").hidden = false;
  globalThis.__HESTIA_CONTINUITY_ERROR__ = message;
  console.error(error);
});
