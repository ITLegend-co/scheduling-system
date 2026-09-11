import assert from "node:assert/strict";
import { handleScheduleConnector, scheduleConnectorTools } from "../functions/connector.js";

const claimTool = scheduleConnectorTools.find((tool) => tool.name === "claim_schedule_update");
const releaseTool = scheduleConnectorTools.find((tool) => tool.name === "release_schedule_update");
assert.deepEqual(claimTool.inputSchema.required, ["submissionId", "claimId"]);
assert.deepEqual(releaseTool.inputSchema.required, ["submissionId", "claimId", "reason"]);
assert.deepEqual(claimTool.securitySchemes, claimTool._meta.securitySchemes);

const metadata = await request({
  method: "GET",
  path: "/.well-known/oauth-protected-resource",
});
assert.equal(metadata.statusCode, 200);
assert.equal(
  metadata.json.resource,
  "https://schedule-d2ce8.web.app/mcp",
);
assert.deepEqual(metadata.json.scopes_supported.sort(), ["schedule.claim", "schedule.read"]);

const pathMetadata = await request({
  method: "GET",
  path: "/.well-known/oauth-protected-resource/mcp",
});
assert.equal(pathMetadata.statusCode, 200);
assert.equal(pathMetadata.json.resource, "https://schedule-d2ce8.web.app/mcp");

const authorization = await request({
  method: "GET",
  path: "/.well-known/oauth-authorization-server",
});
assert.equal(authorization.statusCode, 200);
assert.equal(authorization.json.issuer, "https://schedule-d2ce8.web.app");
assert.equal(authorization.json.code_challenge_methods_supported[0], "S256");
assert.equal(authorization.json.token_endpoint_auth_methods_supported[0], "none");

const unauthorized = await request({
  method: "POST",
  path: "/mcp",
  headers: { accept: "application/json, text/event-stream" },
  body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
});
assert.equal(unauthorized.statusCode, 401);
assert.match(unauthorized.headers["www-authenticate"], /oauth-protected-resource/);
assert.match(unauthorized.headers["www-authenticate"], /error="invalid_token"/);

const invalidOrigin = await request({
  method: "POST",
  path: "/mcp",
  headers: { origin: "https://attacker.example" },
  body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
});
assert.equal(invalidOrigin.statusCode, 403);
assert.equal(invalidOrigin.json.error, "invalid_origin");

const invalidRegistration = await request({
  method: "POST",
  path: "/oauth/register",
  body: {
    redirect_uris: ["https://attacker.example/callback"],
    token_endpoint_auth_method: "none",
  },
});
assert.equal(invalidRegistration.statusCode, 400);
assert.equal(invalidRegistration.json.error, "invalid_client_metadata");

const missing = await request({ method: "GET", path: "/missing" });
assert.equal(missing.statusCode, 404);

console.log("Schedule connector route tests passed.");

async function request(options) {
  const response = mockResponse();
  await handleScheduleConnector({
    method: options.method,
    path: options.path,
    url: options.path,
    query: options.query || {},
    body: options.body,
    get(name) {
      return options.headers?.[String(name).toLowerCase()] || "";
    },
  }, response);
  return response.result;
}

function mockResponse() {
  const result = {
    statusCode: 200,
    headers: {},
    type: "",
    body: "",
    json: null,
    redirectUrl: "",
  };

  return {
    result,
    set(name, value) {
      result.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    status(value) {
      result.statusCode = value;
      return this;
    },
    type(value) {
      result.type = value;
      return this;
    },
    send(value) {
      result.body = String(value);
      result.json = JSON.parse(result.body);
      return this;
    },
    end() {
      return this;
    },
    redirect(status, url) {
      result.statusCode = status;
      result.redirectUrl = url;
      return this;
    },
  };
}
