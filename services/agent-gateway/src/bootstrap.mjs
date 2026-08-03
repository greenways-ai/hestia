import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { hcp1Pack } from "../../../browser/src/agent-hcv1.js";
import {
  mergeHcv1Cells,
  profilePolicyRoots,
  roomPolicyRoots
} from "../../../browser/src/agent-room-records.js";
import { loadEnvironmentSigner } from "./environment-signer.mjs";

const DEFAULT_INVITE_PURPOSES = Object.freeze([
  "document.comment",
  "negotiation.propose",
  "room.message"
]);

function rootBytes(root, name) {
  const value = String(root ?? "").replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`invalid ${name}`);
  return Buffer.from(value, "hex");
}

function environmentId(value) {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    throw new Error("invalid Hestia environment identifier");
  }
  return value;
}

export async function bootstrapAgentEnvironment({
  url = process.env.HESTIA_ADMIN_DATABASE_URL,
  environment = process.env.HESTIA_ENVIRONMENT_ID ?? "hestia-local",
  signingKeyFile = process.env.HESTIA_ENVIRONMENT_SIGNING_KEY_FILE,
  allowedInvitePurposes = DEFAULT_INVITE_PURPOSES,
  sql: suppliedSql
} = {}) {
  if (!url && !suppliedSql) throw new Error("HESTIA_ADMIN_DATABASE_URL is required");
  const id = environmentId(environment);
  const signer = await loadEnvironmentSigner(signingKeyFile);
  const profile = await profilePolicyRoots();
  const room = await roomPolicyRoots();
  const bootstrapCells = mergeHcv1Cells(
    profile.bootstrap.hcv1Cells,
    room.bootstrap.hcv1Cells
  );
  const bootstrapPack = Buffer.from(hcp1Pack(bootstrapCells), "utf8");
  const ownedSql = suppliedSql ? null : postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {}
  });
  const sql = suppliedSql ?? ownedSql;
  try {
    const result = await sql.begin(async (transaction) => {
      const imported = await transaction`
        SELECT gw_ledger.snapshot_pack_import(
          ${bootstrapPack},
          ${bootstrapCells.length}::bigint
        ) AS imported
      `;
      if (imported.length !== 1 || imported[0].imported !== true) {
        throw new Error("Hestia policy HCP1 bootstrap import failed");
      }
      const signerRows = await transaction`
        SELECT encode(
          hestia.environment_signer_register(
            ${id},
            ${signer.publicKeyBytes}
          ),
          'hex'
        ) AS key_root_hex
      `;
      if (signerRows.length !== 1) throw new Error("environment signer registration failed");
      await transaction`
        SELECT * FROM hestia.environment_agent_policy_register(
          ${id},
          ${rootBytes(profile.policyRoot, "profile policy root")},
          ${rootBytes(profile.kernelRoot, "profile kernel root")}
        )
      `;
      await transaction`
        SELECT * FROM hestia.environment_room_policy_register(
          ${id},
          ${rootBytes(room.policyRoot, "room policy root")},
          ${rootBytes(room.kernelRoot, "room kernel root")},
          ${[...allowedInvitePurposes]}::text[]
        )
      `;
      return {
        environment_id: id,
        environment_key_root: `sha256:${signerRows[0].key_root_hex}`,
        environment_public_key: signer.publicKeyBase64Url,
        profile_policy_root: profile.policyRoot,
        profile_kernel_root: profile.kernelRoot,
        room_policy_root: room.policyRoot,
        room_kernel_root: room.kernelRoot,
        allowed_invite_purposes: [...allowedInvitePurposes],
        bootstrap_cell_count: bootstrapCells.length
      };
    });
    return Object.freeze(result);
  } finally {
    if (ownedSql) await ownedSql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await bootstrapAgentEnvironment()));
}
