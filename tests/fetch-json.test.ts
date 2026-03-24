import assert from "node:assert/strict";
import test from "node:test";

import { formatApiError, readJsonResponse } from "@/lib/http/fetchJson";

test("readJsonResponse tolerates empty error bodies", async () => {
  const response = new Response("", {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });

  const result = await readJsonResponse(response);

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.data, null);
  assert.match(result.error ?? "", /status 500/i);
});

test("readJsonResponse tolerates non-json bodies", async () => {
  const response = new Response("<html>boom</html>", {
    status: 500,
    headers: { "Content-Type": "text/html" },
  });

  const result = await readJsonResponse(response);

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_JSON_RESPONSE");
  assert.match(result.details ?? "", /html/i);
});

test("readJsonResponse prefers structured message fields from route helpers", async () => {
  const response = new Response(JSON.stringify({
    ok: false,
    error: true,
    code: "INTERNAL_ERROR",
    message: "Unable to load system stats.",
    details: "boom",
    likelyMigrationIssue: false,
    hint: null,
  }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });

  const result = await readJsonResponse(response);

  assert.equal(result.error, "Unable to load system stats.");
  assert.equal(result.code, "INTERNAL_ERROR");
});

test("formatApiError appends migration hints for likely migration failures", () => {
  const message = formatApiError({
    error: "Unable to load backtest runs.",
    details: "The table does not exist.",
    likelyMigrationIssue: true,
    hint: "Run npm run migrate:deploy.",
  }, "fallback");

  assert.match(message, /Unable to load backtest runs/i);
  assert.match(message, /migrate:deploy/i);
});
