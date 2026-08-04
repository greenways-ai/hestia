import {
  keyFingerprint,
  verifyAgentProfile,
  verifyDelegation
} from "./agent-protocol.js";
import { documentRootHex } from "./document-hcv1.js";

function sameRoot(left, right) {
  try {
    return documentRootHex(left) === documentRootHex(right);
  } catch {
    return false;
  }
}

function sameJwk(left, right) {
  const normalise = (value) => Object.fromEntries(
    Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify(normalise(left)) === JSON.stringify(normalise(right));
}

export async function verifyDocumentRoomMember(member, {
  documentId,
  at = new Date()
} = {}) {
  if (!member?.memberId || !member?.publicKeyJwk
      || !member?.profileRecord?.root || !member?.delegationRecord?.root) {
    throw new Error("document room member is incomplete");
  }
  const profile = await verifyAgentProfile(member.profileRecord, { at });
  if (profile.body.profile_id !== member.memberId) {
    throw new Error("document room member id does not match its signed profile");
  }
  const operationalKeyId = await keyFingerprint(member.publicKeyJwk);
  if (operationalKeyId !== profile.body.operational_key.id
      || !sameJwk(member.publicKeyJwk, profile.body.operational_key.public_jwk)) {
    throw new Error("document room member key is not the active profile operational key");
  }
  if (!sameRoot(member.delegationRecord, profile.body.delegation)) {
    throw new Error("document room delegation is not the delegation committed by the profile");
  }
  const delegation = await verifyDelegation(
    member.delegationRecord,
    profile.rootPublicKey,
    { purpose: "document.edit", at }
  );
  if (delegation.issuer_profile_id !== member.memberId
      || delegation.subject_key !== operationalKeyId
      || !sameJwk(delegation.subject_public_jwk, member.publicKeyJwk)) {
    throw new Error("document room delegation subject does not match the member key");
  }
  if (delegation.scope?.profile_id && delegation.scope.profile_id !== member.memberId) {
    throw new Error("document room delegation profile scope mismatch");
  }
  const scopedDocument = delegation.scope?.document_id ?? delegation.scope?.document;
  if (documentId && scopedDocument && scopedDocument !== documentId) {
    throw new Error("document room delegation document scope mismatch");
  }
  return Object.freeze({ profile, delegation, operationalKeyId });
}

export function assertGenesisMemberBinding(projection, member) {
  if (!projection || projection.member_id !== member?.memberId) {
    throw new Error("document room genesis member identity mismatch");
  }
  if (!sameJwk(projection.public_key_jwk, member.publicKeyJwk)
      || !sameRoot(projection.profile_root, member.profileRecord)
      || !sameRoot(projection.delegation_root, member.delegationRecord)) {
    throw new Error("document room genesis member roots do not match the verified peer");
  }
  return true;
}
