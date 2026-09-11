import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { logger } from "firebase-functions";

const BASE_URL = "https://schedule-d2ce8.web.app";
const MCP_RESOURCE = `${BASE_URL}/mcp`;
const AUTH_PAGE = "https://itlegend-co.github.io/scheduling-system/connector-auth.html";
const ISSUER = BASE_URL;
const SCOPES = new Set(["schedule.read", "schedule.claim"]);
const ACCESS_TOKEN_TTL = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;
const AUTH_REQUEST_TTL = 10 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;
const PROCESSING_LEASE = 60 * 60 * 1000;

const TOOL_SECURITY = [{ type: "oauth2", scopes: ["schedule.read", "schedule.claim"] }];
export const scheduleConnectorTools = [
  {
    name: "list_pending_schedule_updates",
    title: "List pending schedule updates",
    description: "List the signed-in operator's pending or expired-lease changes-only schedule requests. Use this before claiming a request.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 10, default: 5 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: TOOL_SECURITY,
    _meta: { securitySchemes: TOOL_SECURITY },
  },
  {
    name: "claim_schedule_update",
    title: "Claim a schedule update",
    description: "Atomically move one available request to processing and return its exact payload. Generate one UUID claimId per processing run and reuse it only when retrying that same claim.",
    inputSchema: {
      type: "object",
      required: ["submissionId", "claimId"],
      properties: {
        submissionId: { type: "string", minLength: 1, maxLength: 180 },
        claimId: { type: "string", minLength: 1, maxLength: 80, description: "A UUID generated once for this processing run." },
        leaseMinutes: { type: "integer", minimum: 15, maximum: 240, default: 60 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: TOOL_SECURITY,
    _meta: { securitySchemes: TOOL_SECURITY },
  },
  {
    name: "get_schedule_update_status",
    title: "Get schedule update status",
    description: "Read the current pending, processing, applied, or failed status for one submitted request.",
    inputSchema: {
      type: "object",
      required: ["submissionId"],
      properties: { submissionId: { type: "string", minLength: 1, maxLength: 180 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: TOOL_SECURITY,
    _meta: { securitySchemes: TOOL_SECURITY },
  },
  {
    name: "release_schedule_update",
    title: "Release a schedule update",
    description: "Return a request held by this exact claim to pending after processing cannot be completed. This cannot mark a request applied.",
    inputSchema: {
      type: "object",
      required: ["submissionId", "claimId", "reason"],
      properties: {
        submissionId: { type: "string", minLength: 1, maxLength: 180 },
        claimId: { type: "string", minLength: 1, maxLength: 80 },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: TOOL_SECURITY,
    _meta: { securitySchemes: TOOL_SECURITY },
  },
];

export async function handleScheduleConnector(request, response) {
  response.set("Cache-Control", "no-store");
  const route = normalizeRoute(request.path || request.url || "/");

  try {
    if (request.method === "GET" && new Set([
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]).has(route)) {
      return sendJson(response, 200, protectedResourceMetadata());
    }
    if (request.method === "GET" && route === "/.well-known/oauth-authorization-server") {
      return sendJson(response, 200, authorizationServerMetadata());
    }
    if (request.method === "POST" && route === "/oauth/register") return await registerClient(request, response);
    if (request.method === "GET" && route === "/oauth/authorize") return await beginAuthorization(request, response);
    if (request.method === "POST" && route === "/oauth/approve") return await approveAuthorization(request, response);
    if (request.method === "POST" && route === "/oauth/deny") return await denyAuthorization(request, response);
    if (request.method === "POST" && route === "/oauth/token") return await exchangeToken(request, response);
    if (new Set(["GET", "POST"]).has(request.method) && route === "/mcp") {
      return await handleMcp(request, response);
    }
    if (request.method === "GET" && route === "/health") return sendJson(response, 200, { ok: true });
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ConnectorError) {
      if (error.status === 429) response.set("Retry-After", "60");
      return sendJson(response, error.status, error.body);
    }
    logger.error("Schedule connector request failed", {
      route,
      method: request.method,
      message: error?.message || "Unknown error",
    });
    return sendJson(response, 500, { error: "server_error", error_description: "The schedule connector could not complete the request." });
  }
}

function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: [...SCOPES],
    resource_documentation: "https://github.com/ITLegend-co/scheduling-system#secure-chatgpt-connector",
  };
}

function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    token_endpoint_auth_methods_supported: ["none"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...SCOPES],
  };
}

async function registerClient(request, response) {
  const body = requireObject(request.body, "registration request");
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length !== 1) {
    oauthError(400, "invalid_client_metadata", "Exactly one trusted redirect URI is required.");
  }
  redirectUris.forEach(validateRedirectUri);
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
    oauthError(400, "invalid_client_metadata", "Only public PKCE clients are supported.");
  }
  await enforceRateLimit(request, "register", 10, 60 * 60 * 1000);

  const clientId = `dcr_${hashToken(JSON.stringify(redirectUris)).slice(0, 43)}`;
  const createdAt = Date.now();
  const clientRef = getDatabase().ref(`smartSchedule/connectorAuth/clients/${clientId}`);
  const result = await clientRef.transaction((current) => current || {
    clientId,
    clientName: cleanText(body.client_name, 120) || "ChatGPT",
    redirectUris,
    createdAt,
  }, undefined, false);
  const client = result.snapshot.val();

  return sendJson(response, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: client.clientName,
  });
}

async function beginAuthorization(request, response) {
  const query = request.query || {};
  const clientId = one(query.client_id);
  const redirectUri = one(query.redirect_uri);
  const state = one(query.state);
  const resource = one(query.resource);
  const scope = normalizeScope(one(query.scope));
  const codeChallenge = one(query.code_challenge);

  if (one(query.response_type) !== "code") oauthError(400, "unsupported_response_type", "Only authorization code is supported.");
  if (one(query.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    oauthError(400, "invalid_request", "A valid S256 PKCE challenge is required.");
  }
  if (resource !== MCP_RESOURCE) oauthError(400, "invalid_target", "The resource parameter is invalid.");
  if (!state || state.length > 1000) oauthError(400, "invalid_request", "A valid state parameter is required.");
  requireScopes(scope);

  const client = await readClient(clientId);
  if (!client.redirectUris.includes(redirectUri)) oauthError(400, "invalid_request", "The redirect URI is not registered.");
  await enforceRateLimit(request, "authorize", 30, 60 * 60 * 1000);

  const authorizationRequestId = randomToken(32);
  await getDatabase().ref(`smartSchedule/connectorAuth/authorizationRequests/${authorizationRequestId}`).set({
    status: "pending",
    clientId,
    redirectUri,
    state,
    resource,
    scope,
    codeChallenge,
    createdAt: Date.now(),
    expiresAt: Date.now() + AUTH_REQUEST_TTL,
  });

  const consentUrl = new URL(AUTH_PAGE);
  consentUrl.searchParams.set("request", authorizationRequestId);
  return response.redirect(302, consentUrl.toString());
}

async function approveAuthorization(request, response) {
  const body = requireObject(request.body, "approval request");
  const authorizationRequestId = requireSafeId(body.authorizationRequestId, "authorizationRequestId", 128);
  const idToken = requireText(body.idToken, "idToken", 10_000);
  const decoded = await getAuth().verifyIdToken(idToken, true);
  if (decoded.email_verified !== true || !(await isOperator(decoded.uid))) {
    oauthError(403, "access_denied", "This Google account is not an approved schedule operator.");
  }

  const authRef = getDatabase().ref(`smartSchedule/connectorAuth/authorizationRequests/${authorizationRequestId}`);
  const now = Date.now();
  const code = randomToken(32);
  let failure = "";
  const result = await authRef.transaction((current) => {
    if (!current || Number(current.expiresAt || 0) < now) {
      failure = "This connection request expired. Start the connection again from ChatGPT.";
      return;
    }
    if (current.status === "approved" && current.uid === decoded.uid && current.code) return current;
    if (current.status !== "pending") {
      failure = "This connection request has already been used.";
      return;
    }
    return { ...current, status: "approved", uid: decoded.uid, approvedAt: now, code };
  }, undefined, false);
  if (failure || !result.committed) oauthError(400, "invalid_request", failure || "The connection request could not be approved.");

  const authorization = result.snapshot.val();
  await getDatabase().ref(`smartSchedule/connectorAuth/codes/${hashToken(authorization.code)}`).set({
    authorizationRequestId,
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    resource: authorization.resource,
    scope: authorization.scope,
    codeChallenge: authorization.codeChallenge,
    uid: decoded.uid,
    createdAt: now,
    expiresAt: now + CODE_TTL,
    used: false,
  });

  return sendJson(response, 200, {
    redirectUrl: authorizationRedirect(authorization.redirectUri, {
      code: authorization.code,
      state: authorization.state,
      iss: ISSUER,
    }),
  });
}

async function denyAuthorization(request, response) {
  const body = requireObject(request.body, "denial request");
  const authorizationRequestId = requireSafeId(body.authorizationRequestId, "authorizationRequestId", 128);
  const authRef = getDatabase().ref(`smartSchedule/connectorAuth/authorizationRequests/${authorizationRequestId}`);
  const snapshot = await authRef.get();
  if (!snapshot.exists()) oauthError(400, "invalid_request", "This connection request no longer exists.");
  const authorization = snapshot.val();
  await authRef.remove();
  return sendJson(response, 200, {
    redirectUrl: authorizationRedirect(authorization.redirectUri, {
      error: "access_denied",
      error_description: "The user declined schedule access.",
      state: authorization.state,
      iss: ISSUER,
    }),
  });
}

async function exchangeToken(request, response) {
  await enforceRateLimit(request, "token", 120, 60 * 60 * 1000);
  const body = formBody(request.body);
  if (body.grant_type === "authorization_code") return exchangeAuthorizationCode(body, response);
  if (body.grant_type === "refresh_token") return exchangeRefreshToken(body, response);
  oauthError(400, "unsupported_grant_type", "Only authorization_code and refresh_token grants are supported.");
}

async function exchangeAuthorizationCode(body, response) {
  const code = requireText(body.code, "code", 500);
  const clientId = requireSafeId(body.client_id, "client_id", 128);
  const redirectUri = requireText(body.redirect_uri, "redirect_uri", 1000);
  const verifier = requireText(body.code_verifier, "code_verifier", 256);
  const resource = requireText(body.resource, "resource", 1000);
  if (resource !== MCP_RESOURCE) oauthError(400, "invalid_target", "The resource parameter is invalid.");

  const codeRef = getDatabase().ref(`smartSchedule/connectorAuth/codes/${hashToken(code)}`);
  const now = Date.now();
  let failure = "";
  let authorization;
  const result = await codeRef.transaction((current) => {
    if (!current || current.used || Number(current.expiresAt || 0) < now) {
      failure = "The authorization code is invalid or expired.";
      return;
    }
    if (current.clientId !== clientId || current.redirectUri !== redirectUri || current.resource !== resource) {
      failure = "The authorization code does not match this client or resource.";
      return;
    }
    if (!safeEqual(pkceChallenge(verifier), current.codeChallenge)) {
      failure = "PKCE verification failed.";
      return;
    }
    authorization = current;
    return { ...current, used: true, usedAt: now };
  }, undefined, false);
  if (failure || !result.committed || !authorization) oauthError(400, "invalid_grant", failure || "The authorization code could not be used.");

  const tokens = await issueTokens(authorization, clientId, true);
  await getDatabase().ref().update({
    [`smartSchedule/connectorAuth/codes/${hashToken(code)}`]: null,
    [`smartSchedule/connectorAuth/authorizationRequests/${authorization.authorizationRequestId}`]: null,
  });
  return sendJson(response, 200, tokens);
}

async function exchangeRefreshToken(body, response) {
  const refreshToken = requireText(body.refresh_token, "refresh_token", 500);
  const clientId = requireSafeId(body.client_id, "client_id", 128);
  const resource = requireText(body.resource, "resource", 1000);
  if (resource !== MCP_RESOURCE) oauthError(400, "invalid_target", "The resource parameter is invalid.");

  const snapshot = await getDatabase().ref(`smartSchedule/connectorAuth/tokens/refresh/${hashToken(refreshToken)}`).get();
  const token = snapshot.val();
  if (!token || token.clientId !== clientId || token.resource !== resource || Number(token.expiresAt || 0) < Date.now()) {
    oauthError(400, "invalid_grant", "The refresh token is invalid or expired.");
  }
  if (!(await isOperator(token.uid))) oauthError(403, "access_denied", "Schedule operator access has been revoked.");
  return sendJson(response, 200, await issueTokens(token, clientId, false));
}

async function issueTokens(authorization, clientId, includeRefreshToken) {
  const now = Date.now();
  const accessToken = randomToken(32);
  const accessRecord = {
    uid: authorization.uid,
    clientId,
    resource: authorization.resource,
    scope: authorization.scope,
    createdAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL,
  };
  const updates = {
    [`smartSchedule/connectorAuth/tokens/access/${hashToken(accessToken)}`]: accessRecord,
  };
  const payload = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL / 1000),
    scope: authorization.scope,
    resource: authorization.resource,
  };

  if (includeRefreshToken) {
    const refreshToken = randomToken(40);
    updates[`smartSchedule/connectorAuth/tokens/refresh/${hashToken(refreshToken)}`] = {
      ...accessRecord,
      expiresAt: now + REFRESH_TOKEN_TTL,
    };
    payload.refresh_token = refreshToken;
  }
  await getDatabase().ref().update(updates);
  return payload;
}

async function handleMcp(request, response) {
  validateMcpOrigin(request);
  const token = await authenticateMcp(request, response);
  if (!token) return;
  if (request.method === "GET") {
    response.set("Allow", "POST");
    return response.status(405).end();
  }
  const rpc = requireObject(request.body, "JSON-RPC request");
  const id = rpc.id ?? null;

  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return rpcError(response, id, -32600, "Invalid JSON-RPC request.");
  }
  if (!Object.hasOwn(rpc, "id")) return response.status(202).end();
  if (rpc.method === "ping") return rpcResult(response, id, {});
  if (rpc.method === "initialize") {
    return rpcResult(response, id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "smart-schedule", version: "1.0.0" },
      instructions: "Use list_pending_schedule_updates, generate one UUID claimId, then claim_schedule_update before editing the GitHub schedule. Reuse that claimId only to retry the same operation. Preserve unmentioned events and ignore Event-Based Tasks. Put the claimed submissionId, claimId, and requestIds in data/update-release.json. Never represent a request as applied: only the post-deployment GitHub job may set applied. If processing cannot continue, use release_schedule_update with the same claimId.",
    });
  }
  if (rpc.method === "tools/list") return rpcResult(response, id, { tools: scheduleConnectorTools });
  if (rpc.method === "tools/call") {
    try {
      const result = await callTool(rpc.params?.name, rpc.params?.arguments || {}, token);
      return rpcResult(response, id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
    } catch (error) {
      const message = error instanceof ConnectorError ? error.body.error_description : error?.message || "Tool call failed.";
      const result = { isError: true, content: [{ type: "text", text: message }] };
      if (error instanceof ConnectorError && error.body.error === "insufficient_scope") {
        result._meta = { "mcp/www_authenticate": [mcpChallenge("insufficient_scope", message)] };
      }
      return rpcResult(response, id, result);
    }
  }
  return rpcError(response, id, -32601, "Method not found.");
}

async function authenticateMcp(request, response) {
  const match = String(request.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return mcpUnauthorized(response);
  const snapshot = await getDatabase().ref(`smartSchedule/connectorAuth/tokens/access/${hashToken(match[1])}`).get();
  const token = snapshot.val();
  if (!token || token.resource !== MCP_RESOURCE || Number(token.expiresAt || 0) < Date.now() || !(await isOperator(token.uid))) {
    return mcpUnauthorized(response);
  }
  return token;
}

function mcpUnauthorized(response) {
  response.set("WWW-Authenticate", mcpChallenge("invalid_token", "Connect an approved Smart Schedule Google account."));
  sendJson(response, 401, { error: "unauthorized", error_description: "Connect an approved Smart Schedule Google account." });
  return null;
}

function mcpChallenge(error, description) {
  const safeDescription = String(description).replace(/[\\"\r\n]/g, " ");
  return `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource", error="${error}", error_description="${safeDescription}", scope="schedule.read schedule.claim"`;
}

function validateMcpOrigin(request) {
  const origin = String(request.get("origin") || "");
  if (!origin) return;
  const allowed = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return;
  if (!allowed.has(origin)) throw new ConnectorError(403, "invalid_origin", "The MCP request origin is not allowed.");
}

async function enforceRateLimit(request, purpose, limit, windowMs) {
  const ip = String(request.ip || request.socket?.remoteAddress || "unknown").slice(0, 200);
  const windowId = Math.floor(Date.now() / windowMs);
  const attemptId = randomToken(12);
  const root = getDatabase().ref(`smartSchedule/connectorAuth/rateLimits/${purpose}`);
  const counterRef = root.child(`${windowId}/${hashToken(ip)}`);
  const result = await counterRef.transaction((current) => {
    if (Number(current?.count || 0) >= limit) return current;
    return {
      count: Number(current?.count || 0) + 1,
      lastAttemptId: attemptId,
      expiresAt: (windowId + 2) * windowMs,
    };
  }, undefined, false);
  root.child(String(windowId - 2)).remove().catch(() => {});
  if (!result.committed || result.snapshot.child("lastAttemptId").val() !== attemptId) {
    throw new ConnectorError(429, "slow_down", "Too many connector requests. Wait before trying again.");
  }
}

async function callTool(name, args, token) {
  requireObject(args, "tool arguments");
  const scopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
  if (name === "list_pending_schedule_updates") {
    requireScope(scopes, "schedule.read");
    return listPending(args, token.uid);
  }
  if (name === "claim_schedule_update") {
    requireScope(scopes, "schedule.claim");
    return claimUpdate(args, token.uid);
  }
  if (name === "get_schedule_update_status") {
    requireScope(scopes, "schedule.read");
    return getUpdateStatus(args, token.uid);
  }
  if (name === "release_schedule_update") {
    requireScope(scopes, "schedule.claim");
    return releaseUpdate(args, token.uid);
  }
  throw new ConnectorError(400, "invalid_tool", "Unknown schedule tool.");
}

async function listPending(args, uid) {
  rejectKeys(args, new Set(["limit"]), "tool arguments");
  const limit = args.limit === undefined ? 5 : requireInteger(args.limit, "limit", 1, 10);
  const root = getDatabase().ref("smartSchedule/updateRequests");
  const [pendingSnapshot, processingSnapshot] = await Promise.all([
    root.orderByChild("ownerStatus").equalTo(`${uid}:pending`).get(),
    root.orderByChild("ownerStatus").equalTo(`${uid}:processing`).get(),
  ]);
  const now = Date.now();
  const pending = Object.values(pendingSnapshot.val() || {});
  const expired = Object.values(processingSnapshot.val() || {})
    .filter((request) => Number(request.leaseUntil || 0) < now);
  const requests = [...pending, ...expired]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(0, limit)
    .map(requestSummary);
  return { count: requests.length, requests };
}

async function claimUpdate(args, uid) {
  rejectKeys(args, new Set(["submissionId", "claimId", "leaseMinutes"]), "tool arguments");
  const submissionId = requireSafeId(args.submissionId, "submissionId", 180);
  const claimId = requireUuid(args.claimId, "claimId");
  const leaseMinutes = args.leaseMinutes === undefined ? 60 : requireInteger(args.leaseMinutes, "leaseMinutes", 15, 240);
  const requestRef = getDatabase().ref(`smartSchedule/updateRequests/${submissionId}`);
  const now = Date.now();
  let failure = "";
  const result = await requestRef.transaction((current) => {
    if (!current || current.ownerUid !== uid) {
      failure = "This schedule request was not found.";
      return;
    }
    if (current.status === "processing" && current.claimId === claimId && Number(current.leaseUntil || 0) >= now) {
      return current;
    }
    const canClaim = current.status === "pending"
      || (current.status === "processing" && Number(current.leaseUntil || 0) < now);
    if (!canClaim) {
      failure = `This schedule request is already ${current.status || "unavailable"}.`;
      return;
    }
    return {
      ...current,
      status: "processing",
      ownerStatus: `${uid}:processing`,
      updatedAt: now,
      claimedAt: now,
      leaseUntil: now + leaseMinutes * 60_000,
      processingBy: `connector:${uid}`,
      claimId,
      attemptCount: Number(current.attemptCount || 0) + 1,
    };
  }, undefined, false);
  if (failure || !result.committed) throw new ConnectorError(409, "request_unavailable", failure || "The request could not be claimed.");
  return { claimed: true, request: publicRequest(result.snapshot.val()) };
}

async function getUpdateStatus(args, uid) {
  rejectKeys(args, new Set(["submissionId"]), "tool arguments");
  const submissionId = requireSafeId(args.submissionId, "submissionId", 180);
  const snapshot = await getDatabase().ref(`smartSchedule/updateRequests/${submissionId}`).get();
  const request = snapshot.val();
  if (!request || request.ownerUid !== uid) throw new ConnectorError(404, "not_found", "This schedule request was not found.");
  return {
    submissionId,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    appliedAt: request.appliedAt || null,
    appliedCommit: request.appliedCommit || null,
  };
}

async function releaseUpdate(args, uid) {
  rejectKeys(args, new Set(["submissionId", "claimId", "reason"]), "tool arguments");
  const submissionId = requireSafeId(args.submissionId, "submissionId", 180);
  const claimId = requireUuid(args.claimId, "claimId");
  const reason = requireText(args.reason, "reason", 500);
  const requestRef = getDatabase().ref(`smartSchedule/updateRequests/${submissionId}`);
  const now = Date.now();
  let failure = "";
  const result = await requestRef.transaction((current) => {
    if (!current || current.ownerUid !== uid) {
      failure = "This schedule request was not found.";
      return;
    }
    if (current.status === "pending") return current;
    if (current.status !== "processing" || current.processingBy !== `connector:${uid}` || current.claimId !== claimId) {
      failure = "Only the exact connector claim can release this request.";
      return;
    }
    const { claimedAt, leaseUntil, processingBy, claimId: storedClaimId, ...rest } = current;
    return {
      ...rest,
      status: "pending",
      ownerStatus: `${uid}:pending`,
      updatedAt: now,
      lastReleasedAt: now,
      lastReleaseReason: reason,
    };
  }, undefined, false);
  if (failure || !result.committed) throw new ConnectorError(409, "request_unavailable", failure || "The request could not be released.");
  return { released: true, submissionId, status: result.snapshot.val().status };
}

function publicRequest(request) {
  return {
    submissionId: request.submissionId,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    claimedAt: request.claimedAt || null,
    leaseUntil: request.leaseUntil || null,
    claimId: request.claimId || null,
    requestIds: Object.keys(request.requestIds || {}),
    payload: restoreDocumentMetadata(request.payload),
  };
}

function requestSummary(request) {
  return {
    submissionId: request.submissionId,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    leaseUntil: request.leaseUntil || null,
    changeCount: Object.keys(request.requestIds || {}).length,
  };
}

async function readClient(clientId) {
  const id = requireSafeId(clientId, "client_id", 128);
  const snapshot = await getDatabase().ref(`smartSchedule/connectorAuth/clients/${id}`).get();
  if (!snapshot.exists()) oauthError(400, "invalid_client", "The OAuth client is not registered.");
  return snapshot.val();
}

async function isOperator(uid) {
  const snapshot = await getDatabase().ref(`smartSchedule/operators/${uid}`).get();
  return snapshot.val() === true;
}

function validateRedirectUri(value) {
  const text = requireText(value, "redirect_uri", 1000);
  let url;
  try {
    url = new URL(text);
  } catch {
    oauthError(400, "invalid_client_metadata", "A redirect URI is invalid.");
  }
  const openAiCallback = url.protocol === "https:"
    && url.hostname === "chatgpt.com"
    && url.pathname === "/connector_platform_oauth_redirect"
    && !url.search;
  if (url.username || url.password || url.hash || !openAiCallback) {
    oauthError(400, "invalid_client_metadata", "Only the stable ChatGPT and Codex callback URL is allowed.");
  }
}

function normalizeScope(value) {
  return [...new Set(String(value || "schedule.read schedule.claim").split(/\s+/).filter(Boolean))].join(" ");
}

function requireScopes(scope) {
  const requested = scope.split(/\s+/).filter(Boolean);
  if (!requested.length || requested.some((item) => !SCOPES.has(item))) oauthError(400, "invalid_scope", "The requested scope is not supported.");
}

function requireScope(scopes, scope) {
  if (!scopes.has(scope)) throw new ConnectorError(403, "insufficient_scope", `The ${scope} scope is required.`);
}

function formBody(value) {
  if (typeof value === "string") return Object.fromEntries(new URLSearchParams(value));
  return requireObject(value, "token request");
}

function authorizationRedirect(redirectUri, values) {
  const url = new URL(redirectUri);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function restoreDocumentMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const restored = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreDocumentMetadata(item)]));
  if (!restored.schemaUrl || restored.$schema) return restored;
  const { schemaUrl, ...document } = restored;
  return { $schema: schemaUrl, ...document };
}

function normalizeRoute(value) {
  const path = String(value || "/").split("?")[0];
  const marker = "/scheduleMcp";
  const index = path.indexOf(marker);
  const route = index === -1 ? path : path.slice(index + marker.length);
  return route || "/";
}

function one(value) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorError(400, "invalid_request", `${label} must be an object.`);
  }
  return value;
}

function rejectKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new ConnectorError(400, "invalid_request", `${label} contains unsupported field ${unexpected}.`);
}

function requireText(value, label, maxLength) {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new ConnectorError(400, "invalid_request", `${label} is missing or invalid.`);
  }
  return value;
}

function requireSafeId(value, label, maxLength) {
  const text = requireText(value, label, maxLength);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new ConnectorError(400, "invalid_request", `${label} is invalid.`);
  return text;
}

function requireUuid(value, label) {
  const text = requireText(value, label, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ConnectorError(400, "invalid_request", `${label} must be a UUID.`);
  }
  return text;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConnectorError(400, "invalid_request", `${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function randomToken(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first));
  const b = Buffer.from(String(second));
  return a.length === b.length && timingSafeEqual(a, b);
}

function oauthError(status, error, description) {
  throw new ConnectorError(status, error, description);
}

function sendJson(response, status, body) {
  return response.status(status).type("application/json").send(JSON.stringify(body));
}

function rpcResult(response, id, result) {
  return sendJson(response, 200, { jsonrpc: "2.0", id, result });
}

function rpcError(response, id, code, message) {
  return sendJson(response, 200, { jsonrpc: "2.0", id, error: { code, message } });
}

class ConnectorError extends Error {
  constructor(status, error, description) {
    super(description);
    this.status = status;
    this.body = { error, error_description: description };
  }
}
