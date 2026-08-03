import { createAgentRoomKernel } from "../hestia-browser/agent-room-kernel.js";
import {
  createAcceptance,
  createAdmissionProof,
  createAgentProfile,
  createDocumentVersion,
  createOffer,
  createRoomEpochKey,
  createRoomInvite,
  encodeRoomInvite,
  generateAgentKey,
  openRoomMessage,
  sealRoomMessage,
  valueRoot,
  verifyAcceptance,
  verifyAdmissionProof,
  verifyAgentProfile,
  verifyAgentRecord
} from "../hestia-browser/agent-protocol.js";
import {
  clearAgentRoomWorkspace,
  loadAgentRoomWorkspace,
  saveAgentRoomWorkspace
} from "../hestia-browser/agent-room-storage.js";
import { randomId } from "../hestia-browser/protocol.js";

const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "statusLight", "statusLabel", "statusDetail", "profileState", "roomState", "epochState",
  "memberState", "documentState", "offerState", "profileFingerprint", "roomIdentifier",
  "guestStatus", "inviteValue", "createProfile", "createRoom", "issueInvite", "admitGuest",
  "attachDocument", "documentText", "documentResult", "sendMessage", "messageText",
  "messageResult", "proposeOffer", "offerTerms", "offerSheet", "acceptOffer",
  "acceptanceResult", "activity", "recordCount", "resetWorkspace", "identityStage",
  "roomStage", "inviteStage", "admissionStage"
].map((id) => [id, $(id)]));

let kernel;
let view;
let workspace;
let busy = false;

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function short(value, head = 13, tail = 8) {
  if (!value) return "—";
  const text = String(value);
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function status(label, detail, kind = "ready") {
  const box = elements.statusLight.parentElement;
  box.classList.toggle("ready", kind === "ready");
  box.classList.toggle("error", kind === "error");
  elements.statusLabel.textContent = label;
  elements.statusDetail.textContent = detail;
}

function commandLabel(command) {
  return `${command.capability}/${command.action}`;
}

async function commitEvent(type, data, root, mutate) {
  const result = await kernel.dispatch(type, data);
  view = result.view;
  workspace.events.push({ type, data });
  mutate?.(workspace);
  workspace.activity.push({
    sequence: workspace.activity.length + 1,
    type,
    root,
    commands: result.commands.map(commandLabel),
    at: new Date().toISOString()
  });
  workspace = await saveAgentRoomWorkspace(workspace);
  render();
  return result;
}

async function run(label, operation) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  status(label, "Cryptographic records and HAL state are being evaluated.", "loading");
  try {
    await operation();
    status("Workspace verified", "The current state replays through the Hara/WASM room kernel.");
  } catch (error) {
    console.error(error);
    status("Action blocked", error?.message ?? String(error), "error");
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    renderButtons();
  }
}

function renderButtons() {
  const hostReady = Boolean(workspace?.host);
  const roomReady = Boolean(workspace?.room);
  const inviteReady = Boolean(workspace?.invite);
  const guestReady = Boolean(workspace?.guest);
  const offer = workspace?.offers?.at(-1);

  elements.createProfile.disabled = busy || hostReady;
  elements.createRoom.disabled = busy || !hostReady || roomReady;
  elements.issueInvite.disabled = busy || !roomReady || inviteReady;
  elements.admitGuest.disabled = busy || !inviteReady || guestReady;
  elements.attachDocument.disabled = busy || !guestReady;
  elements.sendMessage.disabled = busy || !guestReady;
  elements.proposeOffer.disabled = busy || !guestReady || Boolean(offer && !workspace.acceptance);
  elements.acceptOffer.disabled = busy || !offer || Boolean(workspace.acceptance);
}

function renderActivity() {
  elements.recordCount.textContent = `${workspace.activity.length} record${workspace.activity.length === 1 ? "" : "s"}`;
  if (!workspace.activity.length) {
    elements.activity.innerHTML = '<li class="empty">No records yet.</li>';
    return;
  }
  elements.activity.innerHTML = [...workspace.activity].reverse().map((entry) => `
    <li>
      <span>${String(entry.sequence).padStart(2, "0")}</span>
      <strong>${escapeHtml(entry.type)}</strong>
      <code>${escapeHtml(short(entry.root, 22, 12))}<br>${escapeHtml(entry.commands.join(" · "))}</code>
    </li>
  `).join("");
}

function renderOffer() {
  const offer = workspace.offers.at(-1);
  if (!offer) {
    elements.offerSheet.innerHTML = '<p class="empty">No offer has been proposed.</p>';
    elements.acceptanceResult.hidden = true;
    return;
  }
  elements.offerSheet.innerHTML = `
    <h3>Signed external offer</h3>
    <blockquote>${escapeHtml(offer.record.body.terms)}</blockquote>
    <dl>
      <div><dt>Offer root</dt><dd>${escapeHtml(offer.record.root)}</dd></div>
      <div><dt>Terms root</dt><dd>${escapeHtml(offer.termsRoot)}</dd></div>
      <div><dt>Offered by</dt><dd>${escapeHtml(offer.record.body.offered_by)}</dd></div>
    </dl>
  `;
  if (workspace.acceptance) {
    elements.acceptanceResult.hidden = false;
    elements.acceptanceResult.innerHTML = `Accepted the exact offer root.<code>${escapeHtml(workspace.acceptance.record.body.offer_root)}</code>`;
  } else {
    elements.acceptanceResult.hidden = true;
  }
}

function renderResults() {
  const document = workspace.documents.at(-1);
  elements.documentResult.hidden = !document;
  if (document) {
    elements.documentResult.innerHTML = `Signed document version attached.<code>${escapeHtml(document.record.root)}</code>`;
  }

  const message = workspace.messages.at(-1);
  elements.messageResult.hidden = !message;
  if (message) {
    elements.messageResult.innerHTML = `“${escapeHtml(message.plaintext)}”<code>${escapeHtml(message.record.root)}</code>`;
  }
  renderOffer();
}

function render() {
  if (!workspace || !view) return;
  elements.profileState.textContent = workspace.host ? "Active" : "Not created";
  elements.roomState.textContent = workspace.room ? "Open" : "Closed";
  elements.epochState.textContent = workspace.epoch?.number ?? "—";
  elements.memberState.textContent = view.member_count ?? 0;
  elements.documentState.textContent = view.document_count ?? 0;
  elements.offerState.textContent = view.offer_count ?? 0;
  elements.profileFingerprint.textContent = workspace.host?.operationalKey.id ?? "No key generated";
  elements.roomIdentifier.textContent = workspace.room?.id ?? "No room created";
  elements.inviteValue.value = workspace.invite?.encoded ?? "";
  elements.guestStatus.textContent = workspace.guest
    ? `Verified · ${short(workspace.guest.operationalKey.id)}`
    : workspace.invite ? "Invite ready for proof" : "Waiting for invite";

  elements.identityStage.classList.toggle("complete", Boolean(workspace.host));
  elements.roomStage.classList.toggle("complete", Boolean(workspace.room));
  elements.inviteStage.classList.toggle("complete", Boolean(workspace.invite));
  elements.admissionStage.classList.toggle("complete", Boolean(workspace.guest));

  renderButtons();
  renderResults();
  renderActivity();
}

async function createHostProfile() {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    name: "Hestia Host Agent",
    rootKey,
    operationalKey
  });
  await verifyAgentProfile(profile.record);
  const data = {
    profile_id: profile.record.body.profile_id,
    profile_root: profile.record.root,
    root_key: rootKey.id,
    operational_key: operationalKey.id,
    delegation_root: profile.delegation.root
  };
  await commitEvent("profile/register", data, profile.record.root, (state) => {
    state.host = { ...profile, rootKey, operationalKey };
  });
}

async function openRoom() {
  const id = `room:${randomId()}`;
  const policy = {
    admission: "signed-capability",
    retention: "commitments",
    acceptance_mode: "human-required"
  };
  const policyRoot = await valueRoot("room/policy", policy);
  const kernelRoot = await valueRoot("hal/kernel", {
    namespace: "hestia.agent-room",
    version: "0.1.0"
  });
  const epochKey = await createRoomEpochKey();
  const data = {
    room_id: id,
    policy_root: policyRoot,
    kernel_root: kernelRoot,
    acceptance_mode: "human-required"
  };
  await commitEvent("room/create", data, policyRoot, (state) => {
    state.room = { id, policy, policyRoot, kernelRoot };
    state.epoch = { number: 1, key: epochKey };
  });
}

async function issueInvite() {
  const invite = await createRoomInvite({
    roomId: workspace.room.id,
    hostProfileRecord: workspace.host.record,
    hostOperationalKey: workspace.host.operationalKey,
    role: "negotiator",
    purposes: ["room.message", "document.comment", "negotiation.propose"]
  });
  const encoded = encodeRoomInvite(invite.record, invite.capability);
  const data = {
    invite_id: invite.record.body.invite_id,
    capability_commitment: invite.record.body.capability_commitment,
    role: invite.record.body.role,
    purposes: invite.record.body.purposes,
    expires_at: invite.record.body.expires_at
  };
  await commitEvent("room/invite", data, invite.record.root, (state) => {
    state.invite = { ...invite, encoded };
  });
}

async function admitExternalAgent() {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    name: "External Review Agent",
    rootKey,
    operationalKey
  });
  const proof = await createAdmissionProof({
    inviteRecord: workspace.invite.record,
    capability: workspace.invite.capability,
    guestProfileRecord: profile.record,
    guestOperationalKey: operationalKey
  });
  await verifyAdmissionProof({
    proofRecord: proof,
    inviteRecord: workspace.invite.record,
    capability: workspace.invite.capability,
    hostProfileRecord: workspace.host.record,
    guestProfileRecord: profile.record
  });
  const epochKey = await createRoomEpochKey();
  const data = {
    invite_id: workspace.invite.record.body.invite_id,
    member_id: profile.record.body.profile_id,
    profile_root: profile.record.root,
    operational_key: operationalKey.id,
    delegation_root: profile.delegation.root,
    proof_root: proof.root,
    proof_verified: true,
    delegation_verified: true,
    invite_valid_verified: true
  };
  await commitEvent("room/admit", data, proof.root, (state) => {
    state.guest = { ...profile, rootKey, operationalKey, proof };
    state.epoch = { number: 2, key: epochKey };
  });
}

async function attachDocument() {
  const content = elements.documentText.value.trim();
  if (!content) throw new Error("document text is required");
  const document = await createDocumentVersion({
    content,
    authorProfileId: workspace.host.record.body.profile_id,
    signingKey: workspace.host.operationalKey
  });
  await verifyAgentRecord(
    document.record,
    workspace.host.operationalKey.publicKey,
    "document/version"
  );
  const data = {
    document_id: document.record.body.document_id,
    document_root: document.record.root,
    policy_root: workspace.room.policyRoot,
    actor_key: workspace.host.operationalKey.id,
    authority_verified: true
  };
  await commitEvent("document/attach", data, document.record.root, (state) => {
    state.documents.push(document);
  });
}

async function sendPrivateMessage() {
  const plaintext = elements.messageText.value.trim();
  if (!plaintext) throw new Error("message text is required");
  const message = await sealRoomMessage({
    roomId: workspace.room.id,
    epoch: workspace.epoch.number,
    senderProfileId: workspace.guest.record.body.profile_id,
    plaintext,
    epochKey: workspace.epoch.key,
    signingKey: workspace.guest.operationalKey
  });
  const opened = await openRoomMessage({
    messageRecord: message,
    epochKey: workspace.epoch.key,
    senderPublicKey: workspace.guest.operationalKey.publicKey
  });
  const data = {
    sender_id: workspace.guest.record.body.profile_id,
    signer_key: workspace.guest.operationalKey.id,
    envelope_root: message.root,
    ciphertext_root: message.body.ciphertext_root,
    member_authorized: true
  };
  await commitEvent("message/send", data, message.root, (state) => {
    state.messages.push({ record: message, plaintext: opened });
  });
}

async function proposeSignedOffer() {
  const terms = elements.offerTerms.value.trim();
  if (!terms) throw new Error("offer terms are required");
  const offer = await createOffer({
    roomId: workspace.room.id,
    terms,
    offeredBy: workspace.guest.record.body.profile_id,
    signingKey: workspace.guest.operationalKey
  });
  await verifyAgentRecord(
    offer.record,
    workspace.guest.operationalKey.publicKey,
    "negotiation/offer"
  );
  const data = {
    offer_id: offer.record.body.offer_id,
    offer_root: offer.record.root,
    terms_root: offer.termsRoot,
    offered_by: offer.record.body.offered_by,
    member_authorized: true
  };
  await commitEvent("negotiation/propose", data, offer.record.root, (state) => {
    state.offers.push(offer);
  });
}

async function acceptExactOffer() {
  const offer = workspace.offers.at(-1);
  if (!offer) throw new Error("no offer is available to accept");
  const approvalRoot = await valueRoot("human/approval", {
    decision: "approve",
    offer_root: offer.record.root,
    approver_profile_id: workspace.host.record.body.profile_id
  });
  const acceptance = await createAcceptance({
    offerRecord: offer.record,
    acceptedBy: workspace.host.record.body.profile_id,
    signingKey: workspace.host.operationalKey,
    humanApprovalRoot: approvalRoot
  });
  await verifyAcceptance({
    offerRecord: offer.record,
    offerPublicKey: workspace.guest.operationalKey.publicKey,
    acceptanceRecord: acceptance,
    acceptancePublicKey: workspace.host.operationalKey.publicKey
  });
  const data = {
    offer_id: offer.record.body.offer_id,
    offer_root: offer.record.root,
    accepted_by: workspace.host.record.body.profile_id,
    acceptance_root: acceptance.root,
    human_approval_root: approvalRoot,
    authority_verified: true,
    human_approval_verified: true
  };
  await commitEvent("negotiation/accept", data, acceptance.root, (state) => {
    state.acceptance = { record: acceptance, approvalRoot };
  });
}

async function initialise() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("Hestia agent rooms require WebCrypto and IndexedDB");
  }
  kernel = await createAgentRoomKernel();
  workspace = await loadAgentRoomWorkspace();
  for (const event of workspace.events) {
    const result = await kernel.dispatch(event.type, event.data);
    view = result.view;
  }
  view ??= await kernel.view();
  render();
  status(
    workspace.events.length ? "Workspace resumed" : "Workspace verified",
    workspace.events.length
      ? `${workspace.events.length} local events replayed through Hara/WASM.`
      : "Create a signed profile to begin."
  );
}

elements.createProfile.addEventListener("click", () => run("Creating host profile", createHostProfile));
elements.createRoom.addEventListener("click", () => run("Opening private room", openRoom));
elements.issueInvite.addEventListener("click", () => run("Signing one-time invitation", issueInvite));
elements.admitGuest.addEventListener("click", () => run("Verifying external agent", admitExternalAgent));
elements.attachDocument.addEventListener("click", () => run("Signing document version", attachDocument));
elements.sendMessage.addEventListener("click", () => run("Encrypting private message", sendPrivateMessage));
elements.proposeOffer.addEventListener("click", () => run("Signing external offer", proposeSignedOffer));
elements.acceptOffer.addEventListener("click", () => run("Binding human approval", acceptExactOffer));
elements.resetWorkspace.addEventListener("click", async () => {
  if (!confirm("Erase the local agent-room workspace and its keys from this browser?")) return;
  await clearAgentRoomWorkspace();
  location.reload();
});

initialise().catch((error) => {
  console.error(error);
  status("Unable to start Hestia", error?.message ?? String(error), "error");
  for (const button of document.querySelectorAll("button")) button.disabled = true;
});
