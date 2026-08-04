import { createAgentProfile, generateAgentKey } from "../../hestia-browser/agent-protocol.js";
import { documentValuePlan } from "../../hestia-browser/document-hcv1.js";
import { createDocumentRoomInvite, parseDocumentRoomInvite } from "../../hestia-browser/document-room-invite.js";
import { createDocumentRoomKernel } from "../../hestia-browser/document-room-kernel.js";
import { DocumentRoomPeer } from "../../hestia-browser/document-room-peer.js";
import { DocumentRoom } from "../../hestia-browser/document-room.js";

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);

let invite;
let role;
let room;
let link;
let ready = false;
let textDraft = null;
let sourceDraft = null;
let pendingText = false;
let pendingSource = false;
let pendingArtefact = false;
let lastArtefact = null;

function initialDocument(roomId) {
  const documentId = `document:${roomId}`;
  return {
    profile: "greenways.rich-text/2",
    id: documentId,
    title: "Living systems memorandum",
    revision: 0,
    children: [
      {
        id: `${documentId}:title`,
        type: "heading",
        attrs: { level: 1 },
        children: [{
          id: `${documentId}:title:text`,
          type: "text",
          text: "Living systems memorandum",
          marks: []
        }]
      },
      {
        id: `${documentId}:paragraph`,
        type: "paragraph",
        attrs: {},
        children: [{
          id: `${documentId}:paragraph:text`,
          type: "text",
          text: "Hello world",
          marks: []
        }]
      },
      {
        id: `${documentId}:artefact`,
        type: "hara-artefact",
        attrs: {
          artefactId: `${documentId}:artefact:value`,
          kind: "value",
          title: "Live calculation",
          mode: "live",
          capabilities: ["studio/eval"]
        },
        children: [{
          id: `${documentId}:artefact:source`,
          type: "text",
          text: "(* 6 7)",
          marks: []
        }]
      }
    ]
  };
}

function clone(value) {
  return structuredClone(value);
}

function findNode(document, id) {
  let found = null;
  function visit(node) {
    if (found) return;
    if (node?.id === id) {
      found = node;
      return;
    }
    for (const child of node?.children || []) visit(child);
  }
  visit(document);
  return found;
}

function nodeIds(document = room?.document) {
  const documentId = document?.id || `document:${invite.room}`;
  return {
    paragraph: `${documentId}:paragraph`,
    text: `${documentId}:paragraph:text`,
    artefact: `${documentId}:artefact`,
    artefactId: `${documentId}:artefact:value`,
    source: `${documentId}:artefact:source`
  };
}

function documentText(document = room?.document) {
  return findNode(document, nodeIds(document).text)?.text ?? "";
}

function artefactNode(document = room?.document) {
  return findNode(document, nodeIds(document).artefact);
}

function artefactSource(document = room?.document) {
  return findNode(document, nodeIds(document).source)?.text ?? "";
}

function short(value, head = 12, tail = 8) {
  if (!value) return "Origin";
  const text = String(value);
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function scalarDiff(previous, next) {
  const before = [...String(previous)];
  const after = [...String(next)];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start
      && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    offset: start,
    deleteCount: beforeEnd - start,
    insert: after.slice(start, afterEnd).join("")
  };
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (value === null) return "nil";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function setStatus(label, detail, kind = "ready") {
  elements.statusLabel.textContent = label;
  elements.statusDetail.textContent = detail;
  elements.roomStatus.dataset.kind = kind;
}

function setBusy(value) {
  document.body.classList.toggle("busy", value);
  updateControls();
}

function updateControls() {
  const active = ready && Boolean(room?.genesis);
  elements.submitText.disabled = !active || pendingText;
  elements.submitSource.disabled = !active || pendingSource;
  elements.runArtefact.disabled = !active;
  const canonicalSource = room ? artefactSource() : "";
  elements.commitArtefact.disabled = !active
    || pendingArtefact
    || !lastArtefact
    || sourceDraft !== null
    || lastArtefact.source !== canonicalSource;
}

function renderDocument({ force = false } = {}) {
  if (!room) return;
  const canonicalText = documentText();
  const canonicalSource = artefactSource();
  const artefact = artefactNode();

  if (force || textDraft === null) elements.bodyText.value = canonicalText;
  if (force || sourceDraft === null) elements.artefactSource.value = canonicalSource;
  elements.artefactMode.textContent = artefact?.attrs?.mode || "live";
  elements.revisionState.textContent = String(room.revision);
  elements.headState.textContent = short(room.headRoot);
  elements.savedState.textContent = textDraft || sourceDraft
    ? `Draft over revision ${textDraft?.baseRevision ?? sourceDraft?.baseRevision ?? room.revision} · head ${room.revision}`
    : `Revision ${room.revision}`;
  updateControls();
}

function renderLedger() {
  if (!room?.history.length) {
    elements.ledgerEntries.innerHTML = '<p class="empty-ledger">No signed revisions yet.</p>';
    return;
  }
  elements.ledgerEntries.innerHTML = [...room.history].reverse().map((entry) => {
    const transformed = entry.transformedOperations[0];
    const detail = transformed?.type === "text.splice"
      ? `text.splice → offset ${transformed.offset}, delete ${transformed.deleteCount}`
      : transformed?.type === "artefact.commit"
        ? "artefact.commit → reviewed source/result roots"
        : transformed?.type || entry.conflict?.code || "no operation";
    return `<article class="ledger-entry ${escapeHtml(entry.outcome)}">
      <header><span>#${entry.sequence}</span><strong>${escapeHtml(entry.outcome)}</strong><em>revision ${entry.revision}</em></header>
      <p>${escapeHtml(detail)}</p>
      ${entry.conflict ? `<blockquote>${escapeHtml(entry.conflict.message)}</blockquote>` : ""}
      <dl>
        <div><dt>Batch</dt><dd>${escapeHtml(short(entry.batchRoot))}</dd></div>
        <div><dt>Transform</dt><dd>${escapeHtml(short(entry.transformationRoot))}</dd></div>
        <div><dt>Revision</dt><dd>${escapeHtml(short(entry.revisionRoot))}</dd></div>
        <div><dt>Receipt</dt><dd>${escapeHtml(short(entry.receiptRoot))}</dd></div>
      </dl>
    </article>`;
  }).join("");
}

function renderRoom() {
  if (!room) return;
  elements.roleBadge.textContent = role === "sequencer" ? "Sequencer kernel" : "Verifying participant";
  elements.roleBadge.dataset.role = role;
  elements.epochState.textContent = String(room.genesis?.record?.body?.epoch || 1);
  elements.localPeer.textContent = short(room.localMember()?.memberId, 18, 6);
  renderDocument();
  renderLedger();
}

function captureTextDraft() {
  if (textDraft) return;
  textDraft = {
    baseRevision: room.revision,
    baseDocument: clone(room.document)
  };
  renderDocument();
}

function captureSourceDraft() {
  if (sourceDraft) return;
  sourceDraft = {
    baseRevision: room.revision,
    baseDocument: clone(room.document)
  };
  lastArtefact = null;
  renderDocument();
}

async function submitTextEdit() {
  captureTextDraft();
  const baseRevision = elements.staleBase.checked ? 0 : textDraft.baseRevision;
  const baseDocument = clone(room.snapshots.get(baseRevision) || textDraft.baseDocument);
  const previous = documentText(baseDocument);
  const next = elements.bodyText.value;
  const change = scalarDiff(previous, next);
  if (!change.deleteCount && !change.insert) {
    setStatus("Nothing to submit", "The shared paragraph matches the selected base revision.");
    return;
  }
  pendingText = true;
  setBusy(true);
  try {
    await link.submit([{
      id: `operation:${crypto.randomUUID()}`,
      type: "text.splice",
      targetId: nodeIds(baseDocument).text,
      ...change
    }], { baseRevision, baseDocument });
    setStatus("Signed batch submitted", `The ${role === "sequencer" ? "local" : "remote"} room kernel is sequencing this edit.`);
  } finally {
    setBusy(false);
  }
}

async function submitSourceEdit() {
  captureSourceDraft();
  const baseRevision = sourceDraft.baseRevision;
  const baseDocument = clone(sourceDraft.baseDocument);
  const change = scalarDiff(artefactSource(baseDocument), elements.artefactSource.value);
  if (!change.deleteCount && !change.insert) {
    setStatus("Nothing to submit", "The HAL source is already canonical.");
    return;
  }
  pendingSource = true;
  setBusy(true);
  try {
    await link.submit([{
      id: `operation:${crypto.randomUUID()}`,
      type: "text.splice",
      targetId: nodeIds(baseDocument).source,
      ...change
    }], { baseRevision, baseDocument });
    setStatus("HAL source submitted", "The source edit is a normal signed text splice in the document ledger.");
  } finally {
    setBusy(false);
  }
}

async function runArtefact() {
  const source = elements.artefactSource.value;
  setBusy(true);
  elements.artefactResult.textContent = "Evaluating in the local Hara room kernel…";
  try {
    const value = await room.evaluateArtefact(source);
    lastArtefact = {
      source,
      value,
      display: formatValue(value),
      mediaType: "application/vnd.hara.value+json"
    };
    elements.artefactResult.textContent = lastArtefact.display;
    setStatus("Live artefact evaluated", "The result is local and ephemeral until you commit a reviewed snapshot.");
  } catch (error) {
    lastArtefact = null;
    elements.artefactResult.textContent = error.message || String(error);
    setStatus("Artefact held", error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function commitArtefact() {
  const source = artefactSource();
  if (!lastArtefact || lastArtefact.source !== source || sourceDraft) {
    throw new Error("Run the current canonical source before committing its snapshot");
  }
  const [sourceRoot, resultRoot] = await Promise.all([
    documentValuePlan(source),
    documentValuePlan(lastArtefact.value)
  ]);
  pendingArtefact = true;
  setBusy(true);
  try {
    await link.submit([{
      id: `operation:${crypto.randomUUID()}`,
      type: "artefact.commit",
      artefactId: nodeIds().artefactId,
      artefactNodeId: nodeIds().artefact,
      sourceTextId: nodeIds().source,
      sourceRoot,
      resultRoot,
      display: lastArtefact.display,
      mediaType: lastArtefact.mediaType
    }]);
    setStatus("Snapshot submitted", "The room will commit the result only if the signed source root is still current.");
  } finally {
    setBusy(false);
  }
}

function sendAwareness(nodeId, field) {
  if (!link || !ready) return;
  link.awareness("cursor", {
    nodeId,
    start: field.selectionStart,
    end: field.selectionEnd,
    revision: room.revision,
    label: room.localMember()?.label || role
  }).catch(() => {});
}

function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  elements.inviteUrl.focus();
  elements.inviteUrl.select();
  document.execCommand("copy");
  return Promise.resolve();
}

function setupInvite() {
  const current = new URL(location.href);
  if (!current.hash) {
    const created = createDocumentRoomInvite(current);
    history.replaceState({}, "", `${created.url.pathname}${created.url.hash}`);
    invite = created;
    role = "sequencer";
  } else {
    invite = parseDocumentRoomInvite(current);
    role = current.searchParams.get("join") === "1" ? "participant" : "sequencer";
  }
  const share = new URL(location.href);
  share.searchParams.set("join", "1");
  share.hash = location.hash;
  elements.inviteUrl.value = share.href;
  elements.copyInvite.hidden = role === "participant";
}

async function createMember() {
  const [rootKey, documentKey] = await Promise.all([
    generateAgentKey(),
    generateAgentKey()
  ]);
  const label = role === "sequencer" ? "Owner kernel" : "Invited kernel";
  const profile = await createAgentProfile({
    profileId: `profile:${role}:${invite.room}`,
    name: label,
    rootKey,
    operationalKey: documentKey,
    purposes: ["profile.update", "document.edit"],
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return {
    rootKey,
    documentKey,
    member: {
      memberId: profile.record.body.profile_id,
      label,
      role: role === "sequencer" ? "sequencer" : "editor",
      publicKeyJwk: documentKey.publicJwk,
      profileRecord: profile.record,
      delegationRecord: profile.delegation
    }
  };
}

async function start() {
  setupInvite();
  setStatus("Creating document identity", "Generating owner-controlled Ed25519 keys for this browser.", "loading");
  const identity = await createMember();
  const document = initialDocument(invite.room);
  const kernel = await createDocumentRoomKernel({
    role,
    roomId: invite.room,
    documentId: document.id
  });
  room = new DocumentRoom({
    role,
    roomId: invite.room,
    document,
    kernel,
    documentKey: identity.documentKey,
    localMember: identity.member
  });
  link = new DocumentRoomPeer({
    invite,
    record: { room: invite.room, status: "pairing" },
    room
  });

  room.addEventListener("commit", ({ detail }) => {
    const local = detail.commit.authorMemberId === room.localMemberId;
    if (local && detail.commit.outcome === "accepted") {
      if (pendingText) {
        pendingText = false;
        textDraft = null;
        elements.staleBase.checked = false;
      }
      if (pendingSource) {
        pendingSource = false;
        sourceDraft = null;
        lastArtefact = null;
      }
      if (pendingArtefact) pendingArtefact = false;
    } else if (local && detail.commit.outcome === "conflict") {
      pendingText = false;
      pendingSource = false;
      pendingArtefact = false;
    }
    renderRoom();
  });
  link.addEventListener("view", ({ detail }) => {
    setStatus(detail.view.status_label, detail.view.status_detail,
      detail.view.phase === "error" ? "error" : "ready");
  });
  link.addEventListener("peer", ({ detail }) => {
    elements.localPeer.textContent = short(link.record.peer_fingerprint, 16, 6);
    elements.remotePeer.textContent = short(detail.fingerprint, 16, 6);
  });
  link.addEventListener("connection-state", ({ detail }) => {
    elements.connectionState.textContent = detail.state;
  });
  link.addEventListener("connected", () => {
    elements.connectionState.textContent = "Authenticated";
  });
  link.addEventListener("ready", () => {
    ready = true;
    elements.bodyText.disabled = false;
    elements.artefactSource.disabled = false;
    setStatus("Document room active", "Both Hara kernels have accepted the signed room genesis.");
    renderRoom();
  });
  link.addEventListener("commit", ({ detail }) => {
    const operation = detail.commit.transformedOperations[0];
    const transformed = operation?.type === "text.splice"
      ? ` Transformed offset: ${operation.offset}.`
      : "";
    setStatus(
      detail.commit.outcome === "accepted" ? "Signed revision accepted" : "Signed conflict retained",
      `Both kernels verified sequence ${detail.commit.sequence}.${transformed}`,
      detail.commit.outcome === "accepted" ? "ready" : "error"
    );
  });
  link.addEventListener("awareness", ({ detail }) => {
    const payload = detail.payload;
    elements.remoteAwarenessDot.classList.add("active");
    elements.remoteAwareness.textContent = `${payload.label || "Peer"} · ${payload.nodeId.includes("artefact") ? "HAL source" : "paragraph"} · ${payload.start}:${payload.end} · revision ${payload.revision}`;
  });
  link.addEventListener("disconnected", () => {
    ready = false;
    elements.connectionState.textContent = "Disconnected";
    updateControls();
  });
  link.addEventListener("error", ({ detail }) => {
    console.error(detail.error);
    setStatus("Room held for review", detail.error?.message || String(detail.error), "error");
  });

  elements.copyInvite.addEventListener("click", async () => {
    await copyText(elements.inviteUrl.value);
    elements.copyInvite.textContent = "Invite copied";
  });
  elements.bodyText.addEventListener("input", () => {
    captureTextDraft();
    sendAwareness(nodeIds().text, elements.bodyText);
  });
  elements.bodyText.addEventListener("select", () => sendAwareness(nodeIds().text, elements.bodyText));
  elements.artefactSource.addEventListener("input", () => {
    captureSourceDraft();
    sendAwareness(nodeIds().source, elements.artefactSource);
  });
  elements.artefactSource.addEventListener("select", () => sendAwareness(nodeIds().source, elements.artefactSource));
  elements.submitText.addEventListener("click", () => submitTextEdit().catch((error) => {
    pendingText = false;
    setStatus("Edit held", error.message || String(error), "error");
    setBusy(false);
  }));
  elements.submitSource.addEventListener("click", () => submitSourceEdit().catch((error) => {
    pendingSource = false;
    setStatus("Source edit held", error.message || String(error), "error");
    setBusy(false);
  }));
  elements.runArtefact.addEventListener("click", () => runArtefact());
  elements.commitArtefact.addEventListener("click", () => commitArtefact().catch((error) => {
    pendingArtefact = false;
    setStatus("Snapshot held", error.message || String(error), "error");
    setBusy(false);
  }));
  elements.staleBase.addEventListener("change", renderDocument);

  renderRoom();
  await link.start();
}

start().catch((error) => {
  console.error(error);
  setStatus("Document room unavailable", error.message || String(error), "error");
});
