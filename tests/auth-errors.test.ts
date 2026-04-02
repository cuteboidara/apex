import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_SERVICE_UNAVAILABLE, resolveSignInErrorMessage } from "@/src/lib/authErrors";

test("sign-in errors surface infrastructure outages clearly", () => {
  assert.equal(
    resolveSignInErrorMessage(AUTH_SERVICE_UNAVAILABLE),
    "Sign-in is temporarily unavailable because the operator database is offline.",
  );
});

test("sign-in errors preserve account moderation feedback", () => {
  assert.equal(
    resolveSignInErrorMessage("Your%20account%20is%20pending%20approval.%20You%20will%20be%20notified%20when%20approved."),
    "Your account is pending approval. You will be notified when approved.",
  );
  assert.equal(
    resolveSignInErrorMessage("Your account has been suspended. Contact support."),
    "Your account has been suspended. Contact support.",
  );
  assert.equal(
    resolveSignInErrorMessage("Your account has been banned."),
    "Your account has been banned.",
  );
});

test("unknown sign-in errors fall back to invalid credentials copy", () => {
  assert.equal(resolveSignInErrorMessage("CredentialsSignin"), "Invalid email or password.");
});
