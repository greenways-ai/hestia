import { pathToFileURL } from "node:url";
import { createAgentAdmissionService } from "./admission-service.mjs";
import { loadEnvironmentSigner } from "./environment-signer.mjs";
import { createAgentGatewayHttpServer } from "./http-server.mjs";
import { createPostgresAdmissionDatabase } from "./postgres-admission.mjs";

export async function startAgentGateway(options = {}) {
  const database = options.database ?? createPostgresAdmissionDatabase(options.databaseOptions);
  const signer = options.signer ?? await loadEnvironmentSigner(
    options.signingKeyFile ?? process.env.HESTIA_ENVIRONMENT_SIGNING_KEY_FILE
  );
  const service = options.service ?? createAgentAdmissionService({
    database,
    signer,
    environmentId: options.environmentId
      ?? process.env.HESTIA_ENVIRONMENT_ID
      ?? "hestia-local"
  });
  await service.health();
  const http = createAgentGatewayHttpServer({ service, ...options.httpOptions });
  await http.listen();

  let closed = false;
  return Object.freeze({
    service,
    http,
    address: http.address(),
    async close() {
      if (closed) return;
      closed = true;
      await http.close();
      await service.close();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = await startAgentGateway();
  console.log(JSON.stringify({
    event: "listening",
    service: "hestia-agent-gateway",
    address: gateway.address
  }));
  const shutdown = async (signal) => {
    try {
      await gateway.close();
      console.log(JSON.stringify({ event: "closed", signal }));
      process.exitCode = 0;
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
