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
