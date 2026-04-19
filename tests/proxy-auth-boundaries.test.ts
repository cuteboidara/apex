import assert from "node:assert/strict";
import test from "node:test";

import { isProtectedApiPath, isPublicApiPath, shouldAllowAnonymousPath } from "@/proxy";

test("proxy keeps secret-backed public APIs accessible without session redirects", () => {
  assert.equal(isPublicApiPath("/api/cycle"), true);
  assert.equal(isPublicApiPath("/api/crypto-cycle"), true);
  assert.equal(isPublicApiPath("/api/crypto/live-prices"), true);
  assert.equal(isPublicApiPath("/api/crypto/signals"), true);
  assert.equal(isPublicApiPath("/api/jobs/daily-signals"), true);
  assert.equal(isPublicApiPath("/api/health"), true);

  assert.equal(isProtectedApiPath("/api/cycle"), false);
  assert.equal(isProtectedApiPath("/api/crypto-cycle"), false);
  assert.equal(isProtectedApiPath("/api/crypto/live-prices"), false);
  assert.equal(isProtectedApiPath("/api/crypto/signals"), false);
  assert.equal(isProtectedApiPath("/api/system/status"), true);

  assert.equal(shouldAllowAnonymousPath("/api/cycle"), true);
  assert.equal(shouldAllowAnonymousPath("/api/crypto-cycle"), true);
  assert.equal(shouldAllowAnonymousPath("/api/crypto/live-prices"), true);
  assert.equal(shouldAllowAnonymousPath("/api/crypto/signals"), true);
  assert.equal(shouldAllowAnonymousPath("/auth/signin"), true);
  assert.equal(shouldAllowAnonymousPath("/signals"), false);
});
