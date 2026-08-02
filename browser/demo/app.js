import { bytesToBase64Url } from "/hestia-browser/encoding.js";
import { createInvite, parseInvite } from "/hestia-browser/invite.js";
import { createRecoveryPackage, generateSigningKey, restoreRecoveryPackage } from "/hestia-browser/keystore.js";
import { CeremonyPeer } from "/hestia-browser/peer.js";
import { canonical, importSigningPublicKey, randomId, sha256 } from "/hestia-browser/protocol.js";
import { generateCeremonyKey, openCeremonyShare, sealShareForCeremony } from "/hestia-browser/recovery.js";
import { combineShares, splitSecret } from "/hestia-browser/shamir.js";
import { createCeremonyKernel } from "/hestia-browser/ceremony-kernel.js";
import {
  appendTranscript,
  createWrappingKey,
  loadCeremony,
  openProtectedShare,
  protectShare,
  saveCeremony
} from "/hestia-browser/storage.js";

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);
let invite;
let record;
let link;
let setupKey;
let peerState;
let pendingRequest;
let pendingApproval;
let stateRetry;
let provisioning = false;
let kernel;
let kernelView;
let nextCapabilityValue = 0;
const capabilityValues = new Map();

function retainCapabilityValue(value) {
  const reference = `browser-value-${++nextCapabilityValue}`;
  capabilityValues.set(reference, value);
  return reference;
}

function takeCapabilityValue(reference) {
  const value = capabilityValues.get(reference);
  capabilityValues.delete(reference);
  if (value === undefined) throw new Error("Hara requested an unknown browser capability value");
  return value;
}

function applyKernelView(view) {
  kernelView = view;
  elements.statusLabel.textContent = view.status_label;
  elements.statusDetail.textContent = view.status_detail;
  elements.invitePanel.hidden = !view.invite_visible;
  elements.ceremonyPanel.hidden = !view.ceremony_visible;
  elements.approvalPanel.hidden = !view.approval_visible;
  elements.requestRecovery.disabled = !view.request_enabled;
  elements.result.hidden = !view.result;
  elements.result.textContent = view.result ?? "";
}

async function executeKernelCommand(command) {
  const [first, second] = command.args ?? [];
  if (command.capability === "persistence" && command.action === "append-and-save") {
    await appendTranscript(record, first, second ?? {});
    await saveCeremony(record);
    render();
    return;
  }
  if (command.capability === "persistence" && command.action === "save") {
    await saveCeremony(record);
    return;
  }
  if (command.capability === "transport" && command.action === "connect") {
    await link.connect();
    return;
  }
  if (command.capability === "transport" && command.action === "send-peer-state") {
    await sendPeerState(Boolean(first));
    return;
  }
  if (command.capability === "crypto" && command.action === "provision") {
    await provisionPackage();
    return;
  }
  if (command.capability === "crypto" && command.action === "create-request") {
    await requestRecovery();
    return;
  }
  if (command.capability === "crypto" && command.action === "release-share") {
    await approveRecovery();
    return;
  }
  if (command.capability === "crypto" && command.action === "restore-and-prove") {
    await receiveRecoveryShare(takeCapabilityValue(second.ref));
    return;
  }
  if (command.capability === "transport" && command.action === "send-rejection") {
    await rejectRecovery();
    return;
  }
  throw new Error(`unsupported Hara capability command: ${command.capability}/${command.action}`);
}

async function dispatchCeremony(type, data = {}) {
  const outcome = await kernel.dispatch(type, data);
  applyKernelView(outcome.view);
  for (const command of outcome.commands) await executeKernelCommand(command);
  return outcome;
}

function setStatus(label, detail) {
  elements.statusLabel.textContent = label;
  elements.statusDetail.textContent = detail;
}

function shortened(value) {
  return value ? value.slice(0, 12) + "…" + value.slice(-8) : "waiting";
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = message;
  elements.activity.prepend(item);
}

function render() {
  if (kernelView) applyKernelView(kernelView);
  if (!invite) return;
  elements.inviteUrl.value = location.href;
  elements.ceremonyId.textContent = invite.ceremony;
  elements.modeLabel.textContent = invite.mode;
  elements.localPeer.textContent = shortened(record?.peer_fingerprint);
  elements.remotePeer.textContent = shortened(link?.peerFingerprint);
  elements.transcriptHead.textContent = shortened(record?.transcript_head);
  elements.requestRecovery.disabled ||= record?.status !== "ready" || link?.channel?.readyState !== "open";
  elements.approveShare.disabled = !pendingApproval;
  elements.rejectShare.disabled = !pendingApproval;
}

async function persist(type, details = {}) {
  await appendTranscript(record, type, details);
  await saveCeremony(record);
  render();
}

async function initializeRecord() {
  record = await loadCeremony(invite.ceremony);
  if (!record) {
    record = {
      ceremony: invite.ceremony,
      mode: invite.mode,
      status: "pairing",
      transcript: []
    };
  } else if (record.mode !== invite.mode) {
    throw new Error("stored ceremony mode does not match invite");
  }
  if (record.status === "consumed") {
    setStatus("Consumed", "This browser erased its single-use share after recovery.");
  }
}

async function startCeremony() {
  kernel ??= await createCeremonyKernel();
  invite = parseInvite(location.href);
  await initializeRecord();
  setupKey = await generateCeremonyKey();
  link = new CeremonyPeer({ invite, record });
  link.addEventListener("peer", async ({ detail }) => {
    await persist("peer/authenticated", { peer: detail.id, fingerprint: detail.fingerprint });
    render();
  });
  link.addEventListener("connected", async () => {
    log("WebRTC ceremony channel connected");
    await dispatchCeremony("transport/connected");
    let attempts = 0;
    clearInterval(stateRetry);
    stateRetry = setInterval(() => {
      if (peerState || ++attempts > 20) {
        clearInterval(stateRetry);
        return;
      }
      sendPeerState(false).catch(showError);
    }, 500);
    render();
  });
  link.addEventListener("connection-state", ({ detail }) => {
    if (detail.state === "connecting") dispatchCeremony("transport/connecting").catch(showError);
  });
  link.addEventListener("message", ({ detail }) => {
    handleMessage(detail.type, detail.payload).catch(showError);
  });
  link.addEventListener("disconnected", () => {
    clearInterval(stateRetry);
    dispatchCeremony("transport/disconnected").catch(showError);
  });
  link.addEventListener("error", ({ detail }) => showError(detail.error));
  await dispatchCeremony("ceremony/join", { mode: invite.mode });
}

async function sendPeerState(response) {
  const setupPublicKey = await crypto.subtle.exportKey("jwk", setupKey.publicKey);
  await link.send("peer/state", {
    ready: record.status === "ready",
    consumed: record.status === "consumed",
    setup_public_key: setupPublicKey,
    response
  });
}

async function handleMessage(type, payload) {
  if (type === "peer/state") {
    peerState = payload;
    clearInterval(stateRetry);
    await dispatchCeremony("peer/state", {
      local_ready: record.status === "ready",
      remote_ready: Boolean(payload.ready),
      consumed: Boolean(payload.consumed),
      response_required: !payload.response,
      leader: record.peer_id < link.peerId && !provisioning
    });
    return;
  }
  if (type === "setup/package") await acceptPackage(payload);
  if (type === "setup/ack") {
    await persist("setup/acknowledged", { peer: link.peerId });
    await dispatchCeremony("setup/ready");
  }
  if (type === "recovery/request") await receiveRecoveryRequest(payload);
  if (type === "recovery/share") await dispatchCeremony("recovery/share-received", {
    ref: retainCapabilityValue(payload)
  });
  if (type === "recovery/reject") {
    pendingRequest = undefined;
    setStatus("Rejected", "The other browser rejected the recovery request.");
    await persist("recovery/rejected", { request: payload.request_id });
  }
  if (type === "recovery/complete") {
    if (record.mode === "single") await consumeCeremony(payload.request_id);
    await persist("recovery/peer-complete", { request: payload.request_id });
  }
}

async function policyHash() {
  const policy = {
    version: 2,
    threshold: 2,
    shares: 2,
    mode: invite.mode,
    peers: [record.peer_id, link.peerId].sort()
  };
  return "sha256:" + bytesToBase64Url(await sha256(canonical(policy)));
}

async function provisionPackage() {
  provisioning = true;
  let created;
  let shares = [];
  try {
    setStatus("Provisioning", "Creating and splitting the encrypted identity recovery package.");
    const policy = await policyHash();
    const signingKeyPair = await generateSigningKey();
    const expectedPublicKey = await crypto.subtle.exportKey("jwk", signingKeyPair.publicKey);
    created = await createRecoveryPackage({
      identity: "demo:" + invite.ceremony,
      keyVersion: 1,
      signingKeyPair,
      policyHash: policy
    });
    shares = await splitSecret(created.recoverySecret, { shares: 2, threshold: 2 });
    if (!record.wrapping_key) record.wrapping_key = await createWrappingKey();
    record.protected_share = await protectShare(shares[0], record.wrapping_key, invite.ceremony);
    record.encrypted_package = created.encryptedPackage;
    record.expected_public_key = expectedPublicKey;
    record.policy_hash = policy;
    record.status = "ready";

    const peerSetupKey = await crypto.subtle.importKey(
      "jwk", peerState.setup_public_key, { name: "ECDH", namedCurve: "P-256" }, false, []
    );
    const envelope = await sealShareForCeremony({
      share: shares[1],
      ceremonyId: invite.ceremony + ":setup",
      browserPublicKey: peerSetupKey,
      keeperSigningKey: record.signing_private,
      keeperId: record.peer_id,
      policyHash: policy,
      expiresAt: new Date(Date.now() + 120_000).toISOString()
    });
    await persist("setup/provisioned", { peer: link.peerId, policy_hash: policy });
    await link.send("setup/package", {
      envelope,
      encrypted_package: created.encryptedPackage,
      expected_public_key: expectedPublicKey,
      policy_hash: policy
    });
    await dispatchCeremony("setup/ready");
    log("Encrypted recovery package split 2-of-2");
    render();
  } finally {
    created?.recoverySecret.fill(0);
    shares.forEach((share) => share.fill(0));
    provisioning = false;
  }
}

async function acceptPackage(payload) {
  const share = await openCeremonyShare({
    envelope: payload.envelope,
    browserPrivateKey: setupKey.privateKey,
    keeperSigningPublicKey: link.peerSigningKey
  });
  try {
    if (!record.wrapping_key) record.wrapping_key = await createWrappingKey();
    record.protected_share = await protectShare(share, record.wrapping_key, invite.ceremony);
    record.encrypted_package = payload.encrypted_package;
    record.expected_public_key = payload.expected_public_key;
    record.policy_hash = payload.policy_hash;
    record.status = "ready";
    await persist("setup/accepted", { peer: link.peerId, policy_hash: record.policy_hash });
    await link.send("setup/ack", { policy_hash: record.policy_hash });
    await dispatchCeremony("setup/ready");
    log("One encrypted share stored in this browser");
    render();
  } finally {
    share.fill(0);
  }
}

async function requestRecovery() {
  if (record.status !== "ready") return;
  const requestId = randomId();
  const keyPair = await generateCeremonyKey();
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  pendingRequest = { requestId, keyPair, expiresAt };
  await persist("recovery/requested", { request: requestId, expires_at: expiresAt });
  await link.send("recovery/request", {
    request_id: requestId,
    browser_public_key: publicKey,
    expires_at: expiresAt
  });
  setStatus("Approval requested", "The other browser must approve release of its share.");
}

async function receiveRecoveryRequest(payload) {
  if (record.status !== "ready") throw new Error("this browser has no active share");
  if (new Date(payload.expires_at).getTime() <= Date.now()) throw new Error("recovery request expired");
  pendingApproval = payload;
  elements.requesterFingerprint.textContent = shortened(link.peerFingerprint);
  await dispatchCeremony("recovery/approval-needed", {
    ...payload,
    requester: link.peerFingerprint
  });
}

async function approveRecovery() {
  const approval = pendingApproval;
  if (!approval) return;
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    pendingApproval = undefined;
    throw new Error("recovery request expired");
  }
  const requesterKey = await crypto.subtle.importKey(
    "jwk", approval.browser_public_key, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const share = await openProtectedShare(record.protected_share, record.wrapping_key, invite.ceremony);
  const envelope = await sealShareForCeremony({
    share,
    ceremonyId: invite.ceremony + ":" + approval.request_id,
    browserPublicKey: requesterKey,
    keeperSigningKey: record.signing_private,
    keeperId: record.peer_id,
    policyHash: record.policy_hash,
    expiresAt: approval.expires_at
  });
  share.fill(0);
  await link.send("recovery/share", { request_id: approval.request_id, envelope });
  await persist("recovery/approved", { request: approval.request_id });
  pendingApproval = undefined;
  setStatus("Share released", "The share was sealed to the requester and sent over WebRTC.");
  render();
}

async function rejectRecovery() {
  const approval = pendingApproval;
  if (!approval) return;
  await link.send("recovery/reject", { request_id: approval.request_id });
  await persist("recovery/rejected-locally", { request: approval.request_id });
  pendingApproval = undefined;
  setStatus("Request rejected", "No share was released.");
  render();
}

async function receiveRecoveryShare(payload) {
  if (!pendingRequest || payload.request_id !== pendingRequest.requestId) {
    throw new Error("unexpected recovery share");
  }
  const remoteShare = await openCeremonyShare({
    envelope: payload.envelope,
    browserPrivateKey: pendingRequest.keyPair.privateKey,
    keeperSigningPublicKey: link.peerSigningKey
  });
  const localShare = await openProtectedShare(record.protected_share, record.wrapping_key, invite.ceremony);
  const secret = await combineShares([localShare, remoteShare]);
  const restored = await restoreRecoveryPackage(record.encrypted_package, secret);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, restored.signingKeyPair.privateKey, challenge
  );
  const expected = await importSigningPublicKey(record.expected_public_key);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, expected, signature, challenge
  );
  localShare.fill(0);
  remoteShare.fill(0);
  secret.fill(0);
  if (!valid) throw new Error("restored identity failed signature proof");

  const requestId = pendingRequest.requestId;
  pendingRequest = undefined;
  await persist("recovery/completed", { request: requestId, proof: "p256-signature-valid" });
  await link.send("recovery/complete", { request_id: requestId });
  if (record.mode === "single") await consumeCeremony(requestId);
  await dispatchCeremony("recovery/complete", { request: requestId });
  log("Recovered identity verified locally");
  render();
}

async function consumeCeremony(requestId) {
  record.protected_share = null;
  record.wrapping_key = null;
  record.status = "consumed";
  await persist("ceremony/consumed", { request: requestId });
}

function showError(error) {
  console.error(error);
  if (kernel) dispatchCeremony("error", { message: error?.message ?? String(error) }).catch(console.error);
  else setStatus("Error", error?.message ?? String(error));
  log("Error: " + (error?.message ?? String(error)));
}

elements.createInvite.addEventListener("click", () => {
  const created = createInvite(location.href, { mode: elements.mode.value });
  history.replaceState(null, "", created.url);
  startCeremony().catch(showError);
});
elements.copyInvite.addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  elements.copyInvite.textContent = "Copied";
});
elements.requestRecovery.addEventListener("click", () => dispatchCeremony("recovery/request").catch(showError));
elements.approveShare.addEventListener("click", () => dispatchCeremony("recovery/approve").catch(showError));
elements.rejectShare.addEventListener("click", () => dispatchCeremony("recovery/reject").catch(showError));
window.addEventListener("beforeunload", () => link?.close());

if (location.hash) startCeremony().catch(async (error) => {
  if (error?.code === "HESTIA_INVITE_V1") {
    history.replaceState(null, "", location.pathname + location.search);
    kernel ??= await createCeremonyKernel();
    await dispatchCeremony("invite/invalid");
    render();
    return;
  }
  showError(error);
});
else createCeremonyKernel().then(async (created) => {
  kernel = created;
  applyKernelView(await kernel.view());
  render();
}).catch(showError);
