import { createServer } from "node:http";
import { openDatabase } from "./postgres.mjs";

const db = await openDatabase();
await db.exec("set role service_role");
const endpoints = {
  sua_snapshot: ["select sua_snapshot() as result", []],
  sua_activity: ["select sua_activity($1, $2) as result", ["p_before", "p_limit"]],
  sua_mutate: ["select sua_mutate($1, $2) as result", ["p_action", "p_data"]],
  sua_login_limit: ["select sua_login_limit($1) as result", ["p_bucket"]],
};

createServer(async (request, response) => {
  if (request.url === "/health") {
    response.end("ok");
    return;
  }
  if (!request.url?.startsWith("/rest/v1/rpc/") || request.method !== "POST" ||
      request.headers.apikey !== process.env.SUA_E2E_DATABASE_KEY) {
    response.writeHead(403).end();
    return;
  }
  const name = request.url.split("/").at(-1);
  if (!Object.hasOwn(endpoints, name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const args = JSON.parse(Buffer.concat(chunks).toString());
    const [sql, parameters] = endpoints[name];
    const { rows } = await db.query(sql, parameters.map((param) => args[param]));
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(rows[0].result));
  } catch (error) {
    console.error("[test-db]", error);
    response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ code: "TEST_SQL" }));
  }
}).listen(54329, "127.0.0.1");
