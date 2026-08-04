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
  "memberState", "mandateState", "workState", "documentState", "messageState", "offerState",
  "receiptState", "profileFingerprint", "roomIdentifier", "guestStatus", "inviteValue",
  "createProfile", "createRoom", "issueInvite", "admitGuest", "createMandate", "mandateBrief",
  "mandateResult", "recordWork", "workResult", "attachDocument", "documentText", "documentResult",
  "sendMessage", "messageText", "messageResult", "proposeOffer", "offerTerms", "counterOffer",
  "counterTerms", "offerSheet", "acceptOffer", "acceptanceResult", "completeMandate",
  "completionResult", "shareReceipt", "receiptAudience", "shareResult", "copyReceipt",
  "receiptStatus", "receiptMandate", "receiptRoot", "receiptAudienceValue", "rotateKey",
  "rotationResult", "revokeGuest", "revocationResult", "closeRoom", "closureResult",
  "activity", "recordCount", "latestReceipt", "copyLatestReceipt", "resetWorkspace", "runFullDemo",
  "identityStage", "roomStage", "inviteStage", "admissionStage", "mandateStage",
  "halProgramName", "halProgramVersion", "halEventCount", "halActiveEvent", "halSource"
].map((id) => [id, $(id)]));

let kernel;
let view;
let workspace;
let program;
let busy = false;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function copyText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function portableEventReceipt({ sequence, type, recordRoot, commands, at, nextView }) {
  const body = {
    version: 1,
    program: `${program.namespace}@${program.version}`,
    program_source_root: program.source_root,
    sequence,
    event_type: type,
    signed_record_root: recordRoot,
    room_id: nextView.room_id ?? null,
    membership_epoch: nextView.membership_epoch ?? 0,
    capabilities: commands,
    recorded_at: at
  };
  return Object.freeze({
    ...body,
    receipt_root: await valueRoot("hestia/event-receipt", body)
  });
}

async function commitEvent(type, data, root, mutate) {
  const result = await kernel.dispatch(type, data);
  view = result.view;
  workspace.events.push({ type, data });
  mutate?.(workspace);
  const sequence = workspace.activity.length + 1;
  const at = new Date().toISOString();
  const commands = result.commands.map(commandLabel);
  const receipt = await portableEventReceipt({
    sequence,
    type,
    recordRoot: root,
    commands,
    at,
    nextView: result.view
  });
  workspace.activity.push({
    sequence,
    type,
    root,
    commands,
    receipt,
    at
  });
  workspace = await saveAgentRoomWorkspace(workspace);
  render();
  return result;
}

async function run(label, operation) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  status(label, "The Hara program is evaluating the workflow and its permitted capabilities.", "loading");
  renderButtons();
  try {
    await operation();
    status(
      workspace.closure ? "Office closed with a complete record" : "Private office verified",
      workspace.closure
        ? "The final receipt and HAL transition history remain available in this browser."
        : "Every visible change replays through the live hestia.agent-room HAL program."
    );
  } catch (error) {
    console.error(error);
    status("Action held for review", error?.message ?? String(error), "error");
    throw error;
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    renderButtons();
  }
}

function renderButtons() {
  if (!workspace) return;
  const hostReady = Boolean(workspace.host);
  const roomReady = Boolean(workspace.room);
  const inviteReady = Boolean(workspace.invite);
  const guestReady = Boolean(workspace.guest);
  const guestActive = guestReady && !workspace.guest.revoked;
  const mandateReady = Boolean(workspace.mandates.at(-1));
  const offerCount = workspace.offers.length;
  const receiptReady = Boolean(workspace.receipts.at(-1));
  const officeOpen = roomReady && !workspace.closure;

  elements.createProfile.disabled = busy || hostReady;
  elements.createRoom.disabled = busy || !hostReady || roomReady;
  elements.issueInvite.disabled = busy || !officeOpen || inviteReady;
  elements.admitGuest.disabled = busy || !officeOpen || !inviteReady || guestReady;
  elements.createMandate.disabled = busy || !officeOpen || !guestActive || mandateReady;
  elements.attachDocument.disabled = busy || !officeOpen || !mandateReady || !guestActive || workspace.documents.length > 0;
  elements.sendMessage.disabled = busy || !officeOpen || !mandateReady || !guestActive || workspace.messages.length > 0;
  elements.recordWork.disabled = busy || !officeOpen || !mandateReady || !guestActive || workspace.work.length > 0;
  elements.proposeOffer.disabled = busy || !officeOpen || !mandateReady || !guestActive || offerCount > 0;
  elements.counterOffer.disabled = busy || !officeOpen || !guestActive || offerCount !== 1 || Boolean(workspace.acceptance);
  elements.acceptOffer.disabled = busy || !officeOpen || offerCount < 1 || Boolean(workspace.acceptance);
  elements.completeMandate.disabled = busy || !officeOpen || !workspace.acceptance || !workspace.work.length || receiptReady;
  elements.shareReceipt.disabled = busy || !officeOpen || !receiptReady || Boolean(workspace.sharedReceipt);
  elements.copyReceipt.disabled = !receiptReady;
  elements.rotateKey.disabled = busy || !officeOpen || !hostReady || workspace.keyRotations.length > 0;
  elements.revokeGuest.disabled = busy || !officeOpen || !guestActive || !receiptReady;
  elements.closeRoom.disabled = busy || !officeOpen || !receiptReady;
  elements.copyLatestReceipt.disabled = !workspace.activity.length;
  elements.runFullDemo.disabled = busy || Boolean(workspace.closure);
  elements.runFullDemo.textContent = workspace.activity.length ? "Complete the HAL office" : "Run the complete HAL office";
}

function renderActivity() {
  elements.recordCount.textContent = `${workspace.activity.length} record${workspace.activity.length === 1 ? "" : "s"}`;
  const latest = workspace.activity.at(-1);
  elements.latestReceipt.textContent = latest?.receipt?.receipt_root ?? "—";
  if (!workspace.activity.length) {
    elements.activity.innerHTML = '<li class="empty">No office activity yet.</li>';
    elements.halActiveEvent.textContent = "Waiting";
    return;
  }
  elements.halActiveEvent.textContent = latest.type;
  elements.activity.innerHTML = [...workspace.activity].reverse().map((entry) => `
    <li>
      <span>${String(entry.sequence).padStart(2, "0")}</span>
      <strong>${escapeHtml(entry.type)}</strong>
      <code>${escapeHtml(short(entry.root, 20, 10))}<br>${escapeHtml(entry.commands.join(" · "))}<br>receipt ${escapeHtml(short(entry.receipt?.receipt_root, 18, 9))}</code>
    </li>
  `).join("");
}

function renderOffer() {
  const offer = workspace.offers.at(-1);
  if (!offer) {
    elements.offerSheet.innerHTML = '<p class="empty">The signed terms will appear here.</p>';
    elements.acceptanceResult.hidden = true;
    return;
  }
  const revision = offer.record.body.supersedes ? "Revised signed terms" : "Initial signed recommendation";
  elements.offerSheet.innerHTML = `
    <h3>${revision}</h3>
    <blockquote>${escapeHtml(offer.record.body.terms)}</blockquote>
    <dl>
      <div><dt>Offer root</dt><dd>${escapeHtml(offer.record.root)}</dd></div>
      <div><dt>Terms root</dt><dd>${escapeHtml(offer.termsRoot)}</dd></div>
      <div><dt>Offered by</dt><dd>${escapeHtml(offer.record.body.offered_by)}</dd></div>
      <div><dt>Supersedes</dt><dd>${escapeHtml(offer.record.body.supersedes ?? "Original proposal")}</dd></div>
    </dl>
  `;
  if (workspace.acceptance) {
    elements.acceptanceResult.hidden = false;
    elements.acceptanceResult.innerHTML = `Human approval is bound to the exact final offer root.<code>${escapeHtml(workspace.acceptance.record.body.offer_root)}</code>`;
  } else {
    elements.acceptanceResult.hidden = true;
  }
}

function renderReceipt() {
  const mandate = workspace.mandates.at(-1);
  const receipt = workspace.receipts.at(-1);
  elements.receiptMandate.textContent = mandate?.id ?? "—";
  elements.receiptRoot.textContent = receipt?.root ?? "—";
  elements.receiptAudienceValue.textContent = workspace.sharedReceipt?.audience ?? "Private";
  elements.receiptStatus.textContent = workspace.sharedReceipt
    ? "Prepared for sharing"
    : receipt ? "Private receipt complete" : "Awaiting completion";

  elements.completionResult.hidden = !receipt;
  if (receipt) {
    elements.completionResult.innerHTML = `The private receipt binds ${receipt.body.event_receipts.length} HAL event receipts and the final human-approved terms.<code>${escapeHtml(receipt.root)}</code>`;
  }
  elements.shareResult.hidden = !workspace.sharedReceipt;
  if (workspace.sharedReceipt) {
    elements.shareResult.innerHTML = `A bounded presentation is ready for ${escapeHtml(workspace.sharedReceipt.audience)}.<code>${escapeHtml(workspace.sharedReceipt.share_root)}</code>`;
  }
}

function renderResults() {
  const mandate = workspace.mandates.at(-1);
  elements.mandateResult.hidden = !mandate;
  if (mandate) {
    elements.mandateResult.innerHTML = `Mandate issued to the specialist.<code>${escapeHtml(mandate.root)}</code>`;
  }

  const document = workspace.documents.at(-1);
  elements.documentResult.hidden = !document;
  if (document) {
    elements.documentResult.innerHTML = `Signed source version attached.<code>${escapeHtml(document.record.root)}</code>`;
  }

  const message = workspace.messages.at(-1);
  elements.messageResult.hidden = !message;
  if (message) {
    elements.messageResult.innerHTML = `“${escapeHtml(message.plaintext)}”<code>${escapeHtml(message.record.root)}</code>`;
  }

  const work = workspace.work.at(-1);
  elements.workResult.hidden = !work;
  if (work) {
    elements.workResult.innerHTML = `The completed workflow step is bound to the mandate and its result.<code>${escapeHtml(work.root)}</code>`;
  }

  const rotation = workspace.keyRotations.at(-1);
  elements.rotationResult.hidden = !rotation;
  if (rotation) {
    elements.rotationResult.innerHTML = `The daily key was replaced without changing the principal profile.<code>${escapeHtml(rotation.profileRoot)}</code>`;
  }

  elements.revocationResult.hidden = !workspace.guest?.revoked;
  if (workspace.guest?.revoked) {
    elements.revocationResult.innerHTML = `The specialist's access ended at key epoch ${escapeHtml(workspace.epoch?.number)}.<code>${escapeHtml(workspace.guest.revocationRoot)}</code>`;
  }

  elements.closureResult.hidden = !workspace.closure;
  if (workspace.closure) {
    elements.closureResult.innerHTML = `The private office is closed with a final state root.<code>${escapeHtml(workspace.closure.root)}</code>`;
  }

  renderOffer();
  renderReceipt();
}

function renderProgram() {
  if (!program) return;
  elements.halProgramName.textContent = program.namespace;
  elements.halProgramVersion.textContent = program.version;
  elements.halEventCount.textContent = String(program.events.length);
  elements.halSource.textContent = program.source;
}

function render() {
  if (!workspace || !view) return;
  const guestActive = workspace.guest && !workspace.guest.revoked;
  elements.profileState.textContent = workspace.host ? "Appointed" : "Not appointed";
  elements.roomState.textContent = workspace.closure ? "Closed" : workspace.room ? "Open" : "Closed";
  elements.epochState.textContent = workspace.epoch?.number ?? "—";
  elements.memberState.textContent = workspace.guest?.revoked
    ? `1 active / ${view.member_count ?? 0} total`
    : String(view.member_count ?? 0);
  elements.mandateState.textContent = String(view.mandate_count ?? 0);
  elements.workState.textContent = String(view.work_count ?? 0);
  elements.documentState.textContent = String(view.document_count ?? 0);
  elements.messageState.textContent = String(view.message_count ?? 0);
  elements.offerState.textContent = String(view.offer_count ?? 0);
  elements.receiptState.textContent = String(view.receipt_count ?? 0);
  elements.profileFingerprint.textContent = workspace.host?.operationalKey.id ?? "No key appointed";
  elements.roomIdentifier.textContent = workspace.room?.id ?? "No office open";
  elements.inviteValue.value = workspace.invite?.encoded ?? "";
  elements.guestStatus.textContent = workspace.guest?.revoked
    ? "Access ended"
    : guestActive
      ? `Active · ${short(workspace.guest.operationalKey.id)}`
      : workspace.invite ? "Invitation ready for proof" : "Waiting for invitation";

  elements.identityStage.classList.toggle("complete", Boolean(workspace.host));
  elements.roomStage.classList.toggle("complete", Boolean(workspace.room));
  elements.inviteStage.classList.toggle("complete", Boolean(workspace.invite));
  elements.admissionStage.classList.toggle("complete", Boolean(workspace.guest));
  elements.mandateStage.classList.toggle("complete", Boolean(workspace.mandates.length));

  renderButtons();
  renderResults();
  renderActivity();
  renderProgram();
}

async function createHostProfile() {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    name: "Hestia Principal Agent",
    rootKey,
    operationalKey,
    purposes: [
      "profile.update", "room.create", "room.invite", "room.join", "room.message",
      "workflow.assign", "workflow.approve", "document.attach", "negotiation.propose",
      "negotiation.accept", "receipt.share"
    ]
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

async function rotateHostKey() {
  const previous = workspace.host;
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    profileId: previous.record.body.profile_id,
    name: previous.record.body.name,
    rootKey: previous.rootKey,
    operationalKey,
    previousProfileRoot: previous.record.root,
    purposes: [
      "profile.update", "room.create", "room.invite", "room.join", "room.message",
      "workflow.assign", "workflow.approve", "document.attach", "negotiation.propose",
      "negotiation.accept", "receipt.share"
    ]
  });
  await verifyAgentProfile(profile.record);
  const data = {
    operational_key: operationalKey.id,
    delegation_root: profile.delegation.root,
    authority_verified: true
  };
  const nextEpochKey = workspace.room ? await createRoomEpochKey() : workspace.epoch?.key;
  await commitEvent("profile/rotate-key", data, profile.record.root, (state) => {
    state.host = { ...profile, rootKey: previous.rootKey, operationalKey };
    state.keyRotations.push({
      profileRoot: profile.record.root,
      operationalKey: operationalKey.id,
      at: new Date().toISOString()
    });
    if (state.room) state.epoch = { number: (state.epoch?.number ?? 0) + 1, key: nextEpochKey };
  });
}

async function openRoom() {
  const id = `room:${randomId()}`;
  const policy = {
    purpose: "private-agent-office",
    admission: "signed-capability",
    workflow: "human-approved",
    receipts: "private-until-shared"
  };
  const policyRoot = await valueRoot("room/policy", policy);
  const kernelRoot = await valueRoot("hal/kernel", {
    namespace: program.namespace,
    version: program.version,
    source_root: program.source_root
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
    role: "specialist",
    purposes: ["room.message", "workflow.record", "document.comment", "negotiation.propose"]
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
    name: "Private Travel Specialist",
    rootKey,
    operationalKey,
    purposes: [
      "profile.update", "room.join", "room.message", "workflow.record",
      "document.comment", "negotiation.propose"
    ]
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
    state.guest = { ...profile, rootKey, operationalKey, proof, revoked: false };
    state.epoch = { number: 2, key: epochKey };
  });
}

async function createSignedMandate() {
  const brief = elements.mandateBrief.value.trim();
  if (!brief) throw new Error("A mandate brief is required");
  const id = `mandate:${randomId()}`;
  const briefRoot = await valueRoot("workflow/brief", brief);
  const workflow = {
    name: "private-travel-review",
    steps: ["review-brief", "compare-options", "record-progress", "propose-terms", "human-approval"],
    booking_authority: false
  };
  const workflowRoot = await valueRoot("workflow/definition", workflow);
  const body = {
    mandate_id: id,
    member_id: workspace.guest.record.body.profile_id,
    brief_root: briefRoot,
    workflow_root: workflowRoot,
    due_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    authority_verified: true
  };
  const root = await valueRoot("workflow/mandate", body);
  await commitEvent("workflow/mandate", body, root, (state) => {
    state.mandates.push({ id, brief, briefRoot, workflow, workflowRoot, root });
  });
}

async function attachDocument() {
  const content = elements.documentText.value.trim();
  if (!content) throw new Error("Document text is required");
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
  if (!plaintext) throw new Error("A progress update is required");
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

async function recordWorkflowStep() {
  const mandate = workspace.mandates.at(-1);
  if (!mandate) throw new Error("A mandate is required");
  const action = {
    step: "compare-options",
    input_document_root: workspace.documents.at(-1)?.record.root ?? mandate.briefRoot,
    performed_by: workspace.guest.record.body.profile_id
  };
  const result = {
    summary: elements.messageText.value.trim() || "The specialist compared the approved options.",
    message_root: workspace.messages.at(-1)?.record.root ?? null
  };
  const actionRoot = await valueRoot("workflow/action", action);
  const resultRoot = await valueRoot("workflow/result", result);
  const data = {
    mandate_id: mandate.id,
    step_id: "compare-options",
    member_id: workspace.guest.record.body.profile_id,
    action_root: actionRoot,
    result_root: resultRoot,
    member_authorized: true
  };
  const root = await valueRoot("workflow/work-entry", data);
  await commitEvent("workflow/record", data, root, (state) => {
    state.work.push({ root, action, actionRoot, result, resultRoot });
  });
}

async function proposeSignedOffer() {
  const terms = elements.offerTerms.value.trim();
  if (!terms) throw new Error("Recommendation terms are required");
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

async function counterSignedOffer() {
  const previous = workspace.offers.at(-1);
  if (!previous) throw new Error("An initial offer is required");
  const terms = elements.counterTerms.value.trim();
  if (!terms) throw new Error("Revised terms are required");
  const offer = await createOffer({
    roomId: workspace.room.id,
    terms,
    offeredBy: workspace.guest.record.body.profile_id,
    signingKey: workspace.guest.operationalKey,
    supersedes: previous.record.root
  });
  await verifyAgentRecord(
    offer.record,
    workspace.guest.operationalKey.publicKey,
    "negotiation/offer"
  );
  const data = {
    supersedes: previous.record.body.offer_id,
    offer_id: offer.record.body.offer_id,
    offer_root: offer.record.root,
    terms_root: offer.termsRoot,
    offered_by: offer.record.body.offered_by,
    member_authorized: true
  };
  await commitEvent("negotiation/counter", data, offer.record.root, (state) => {
    state.offers.push(offer);
  });
}

async function acceptExactOffer() {
  const offer = workspace.offers.at(-1);
  if (!offer) throw new Error("No recommendation is available to approve");
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

async function completeSignedMandate() {
  const mandate = workspace.mandates.at(-1);
  const finalOffer = workspace.offers.at(-1);
  if (!mandate || !workspace.acceptance || !finalOffer) throw new Error("The mandate needs approved final terms");
  const completionBody = {
    mandate_root: mandate.root,
    work_roots: workspace.work.map((entry) => entry.root),
    accepted_offer_root: finalOffer.record.root,
    acceptance_root: workspace.acceptance.record.root
  };
  const completionRoot = await valueRoot("workflow/completion", completionBody);
  const receiptBody = {
    version: 1,
    title: "Private travel review",
    office_id: workspace.room.id,
    principal_profile_root: workspace.host.record.root,
    specialist_profile_root: workspace.guest.record.root,
    mandate_root: mandate.root,
    brief_roots: workspace.documents.map((document) => document.record.root),
    work_roots: workspace.work.map((entry) => entry.root),
    update_commitments: workspace.messages.map((message) => message.record.root),
    offer_roots: workspace.offers.map((offer) => offer.record.root),
    acceptance_root: workspace.acceptance.record.root,
    hal_program: `${program.namespace}@${program.version}`,
    hal_source_root: program.source_root,
    event_receipts: workspace.activity.map((entry) => entry.receipt.receipt_root),
    completed_at: new Date().toISOString()
  };
  const receiptRoot = await valueRoot("hestia/work-receipt", receiptBody);
  const receiptId = `receipt:${randomId()}`;
  const data = {
    mandate_id: mandate.id,
    completion_root: completionRoot,
    receipt_id: receiptId,
    receipt_root: receiptRoot,
    authority_verified: true,
    human_approval_verified: true
  };
  await commitEvent("workflow/complete", data, receiptRoot, (state) => {
    state.receipts.push({ id: receiptId, root: receiptRoot, body: receiptBody, completionRoot });
  });
}

async function shareFinalReceipt() {
  const receipt = workspace.receipts.at(-1);
  if (!receipt) throw new Error("Complete the mandate before sharing a receipt");
  const audience = elements.receiptAudience.value.trim() || "Trusted recipient";
  const presentation = {
    version: 1,
    receipt_root: receipt.root,
    audience,
    disclosed: {
      title: receipt.body.title,
      completed_at: receipt.body.completed_at,
      mandate_root: receipt.body.mandate_root,
      acceptance_root: receipt.body.acceptance_root,
      hal_program: receipt.body.hal_program
    }
  };
  const shareRoot = await valueRoot("hestia/receipt-presentation", presentation);
  const data = {
    receipt_id: receipt.id,
    receipt_root: receipt.root,
    audience,
    share_root: shareRoot,
    authority_verified: true
  };
  await commitEvent("receipt/share", data, shareRoot, (state) => {
    state.sharedReceipt = { audience, share_root: shareRoot, presentation };
  });
}

async function revokeExternalAgent() {
  const revocationRoot = await valueRoot("room/revocation", {
    room_id: workspace.room.id,
    member_id: workspace.guest.record.body.profile_id,
    reason: "mandate-complete",
    previous_epoch: workspace.epoch.number
  });
  const epochKey = await createRoomEpochKey();
  const data = {
    member_id: workspace.guest.record.body.profile_id,
    revocation_root: revocationRoot,
    authority_verified: true
  };
  await commitEvent("room/revoke", data, revocationRoot, (state) => {
    state.guest.revoked = true;
    state.guest.revocationRoot = revocationRoot;
    state.epoch = { number: state.epoch.number + 1, key: epochKey };
  });
}

async function closePrivateOffice() {
  const closureBody = {
    room_id: workspace.room.id,
    final_receipt_root: workspace.receipts.at(-1)?.root ?? null,
    shared_receipt_root: workspace.sharedReceipt?.share_root ?? null,
    final_epoch: workspace.epoch.number,
    closed_at: new Date().toISOString()
  };
  const closureRoot = await valueRoot("room/closure", closureBody);
  const data = {
    closure_root: closureRoot,
    authority_verified: true
  };
  await commitEvent("room/close", data, closureRoot, (state) => {
    state.closure = { root: closureRoot, body: closureBody };
  });
}

async function runCompleteOffice() {
  const steps = [
    [() => !workspace.host, "Appointing the principal agent", createHostProfile],
    [() => !workspace.room, "Opening the private office", openRoom],
    [() => !workspace.invite, "Preparing the bounded invitation", issueInvite],
    [() => !workspace.guest, "Admitting the specialist", admitExternalAgent],
    [() => !workspace.mandates.length, "Issuing the signed mandate", createSignedMandate],
    [() => !workspace.documents.length, "Attaching the approved brief", attachDocument],
    [() => !workspace.messages.length, "Recording the private update", sendPrivateMessage],
    [() => !workspace.work.length, "Recording the workflow step", recordWorkflowStep],
    [() => workspace.offers.length === 0, "Receiving the initial recommendation", proposeSignedOffer],
    [() => workspace.offers.length === 1, "Receiving revised terms", counterSignedOffer],
    [() => !workspace.acceptance, "Binding human approval", acceptExactOffer],
    [() => !workspace.receipts.length, "Completing the mandate receipt", completeSignedMandate],
    [() => !workspace.sharedReceipt, "Preparing the bounded receipt presentation", shareFinalReceipt],
    [() => !workspace.keyRotations.length, "Rotating the principal's daily key", rotateHostKey],
    [() => workspace.guest && !workspace.guest.revoked, "Ending specialist access", revokeExternalAgent],
    [() => !workspace.closure, "Closing the private office", closePrivateOffice]
  ];
  for (const [needed, label, operation] of steps) {
    if (!needed()) continue;
    status(label, "The next transition is being evaluated by hestia.agent-room.", "loading");
    await operation();
    await wait(120);
  }
}

async function initialise() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("Hestia Private Agent Office requires WebCrypto and IndexedDB");
  }
  kernel = await createAgentRoomKernel();
  const loadedProgram = await kernel.program();
  program = {
    ...loadedProgram,
    source_root: await valueRoot("hal/source", loadedProgram.source)
  };
  workspace = await loadAgentRoomWorkspace();
  workspace.program = {
    namespace: program.namespace,
    version: program.version,
    source_root: program.source_root,
    events: program.events
  };
  for (const event of workspace.events) {
    const result = await kernel.dispatch(event.type, event.data);
    view = result.view;
  }
  view ??= await kernel.view();
  workspace = await saveAgentRoomWorkspace(workspace);
  render();
  status(
    workspace.events.length ? "Private office resumed" : "HAL office ready",
    workspace.events.length
      ? `${workspace.events.length} local transitions replayed through ${program.namespace}@${program.version}.`
      : `${program.events.length} HAL transitions are ready in this browser.`
  );
  globalThis.__HESTIA_AGENT_OFFICE_READY__ = true;
}

elements.createProfile.addEventListener("click", () => run("Appointing principal agent", createHostProfile).catch(() => undefined));
elements.createRoom.addEventListener("click", () => run("Opening private office", openRoom).catch(() => undefined));
elements.issueInvite.addEventListener("click", () => run("Issuing bounded invitation", issueInvite).catch(() => undefined));
elements.admitGuest.addEventListener("click", () => run("Verifying specialist", admitExternalAgent).catch(() => undefined));
elements.createMandate.addEventListener("click", () => run("Issuing signed mandate", createSignedMandate).catch(() => undefined));
elements.attachDocument.addEventListener("click", () => run("Signing approved brief", attachDocument).catch(() => undefined));
elements.sendMessage.addEventListener("click", () => run("Recording private update", sendPrivateMessage).catch(() => undefined));
elements.recordWork.addEventListener("click", () => run("Recording workflow step", recordWorkflowStep).catch(() => undefined));
elements.proposeOffer.addEventListener("click", () => run("Receiving signed recommendation", proposeSignedOffer).catch(() => undefined));
elements.counterOffer.addEventListener("click", () => run("Receiving revised terms", counterSignedOffer).catch(() => undefined));
elements.acceptOffer.addEventListener("click", () => run("Binding human approval", acceptExactOffer).catch(() => undefined));
elements.completeMandate.addEventListener("click", () => run("Completing mandate receipt", completeSignedMandate).catch(() => undefined));
elements.shareReceipt.addEventListener("click", () => run("Preparing shareable receipt", shareFinalReceipt).catch(() => undefined));
elements.rotateKey.addEventListener("click", () => run("Rotating operational key", rotateHostKey).catch(() => undefined));
elements.revokeGuest.addEventListener("click", () => run("Ending specialist access", revokeExternalAgent).catch(() => undefined));
elements.closeRoom.addEventListener("click", () => run("Closing private office", closePrivateOffice).catch(() => undefined));
elements.runFullDemo.addEventListener("click", () => run("Running the complete HAL office", runCompleteOffice).catch(() => undefined));

elements.copyReceipt.addEventListener("click", async () => {
  const receipt = workspace.sharedReceipt ?? workspace.receipts.at(-1);
  if (!receipt) return;
  await copyText(receipt);
  status("Receipt copied", "The bounded JSON receipt is ready to paste into a message, document or audit file.");
});

elements.copyLatestReceipt.addEventListener("click", async () => {
  const receipt = workspace.activity.at(-1)?.receipt;
  if (!receipt) return;
  await copyText(receipt);
  status("Event receipt copied", "The latest HAL transition receipt is on the clipboard.");
});

elements.resetWorkspace.addEventListener("click", async () => {
  if (!confirm("Clear this local agent office and its browser-held keys?")) return;
  await clearAgentRoomWorkspace();
  location.reload();
});

initialise().catch((error) => {
  console.error(error);
  globalThis.__HESTIA_AGENT_OFFICE_ERROR__ = error?.message ?? String(error);
  status("Unable to open the private office", error?.message ?? String(error), "error");
  for (const button of document.querySelectorAll("button")) button.disabled = true;
});
