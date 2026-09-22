import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import {
  bearerTokenFrom,
  createClerkPlatformAuthenticator,
  principalFromClerkClaims,
} from "../src/clerk-authentication.js";

function requestWith(headers: Record<string, string>): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage;
  Object.assign(request, { headers });
  return request;
}

test("bearerTokenFrom extracts only a well-formed JWT-shaped bearer token", () => {
  assert.equal(bearerTokenFrom(requestWith({})), null);
  assert.equal(bearerTokenFrom(requestWith({ authorization: "Basic dXNlcjpwYXNz" })), null);
  assert.equal(bearerTokenFrom(requestWith({ authorization: "Bearer not-a-jwt" })), null);
  assert.equal(bearerTokenFrom(requestWith({ authorization: "Bearer aaa.bbb.ccc" })), "aaa.bbb.ccc");
  assert.equal(bearerTokenFrom(requestWith({ authorization: "  Bearer   aaa.bbb.ccc  " })), "aaa.bbb.ccc",
    "surrounding and internal whitespace around the scheme is tolerated");
  assert.equal(bearerTokenFrom(requestWith({ authorization: "Bearer aaa.bbb.ccc extra" })), null,
    "trailing garbage after the token must be rejected");
});

test("principalFromClerkClaims rejects any claims set without a userId and an active organisation", () => {
  assert.equal(principalFromClerkClaims(null), null);
  assert.equal(principalFromClerkClaims(undefined), null);
  assert.equal(principalFromClerkClaims({}), null);
  assert.equal(principalFromClerkClaims({ sub: "user_1" }), null, "no org_id means no tenant authority");
  assert.equal(principalFromClerkClaims({ sub: "user_1", org_id: "" }), null);
  assert.equal(principalFromClerkClaims({ sub: "", org_id: "org_1" }), null);
  assert.equal(principalFromClerkClaims({ sub: 123, org_id: "org_1" }), null, "wrong claim types fail closed");
  assert.deepEqual(principalFromClerkClaims({ sub: "user_1", org_id: "org_1", org_role: "admin" }),
    { organizationId: "org_1", userId: "user_1" });
});

test("createClerkPlatformAuthenticator rejects a secret key that is not a real Clerk backend key", () => {
  assert.throws(() => createClerkPlatformAuthenticator({ secretKey: "" }), /clerk_secret_key_invalid/);
  assert.throws(() => createClerkPlatformAuthenticator({ secretKey: "pk_live_not_a_secret_key" }), /clerk_secret_key_invalid/);
  assert.doesNotThrow(() => createClerkPlatformAuthenticator({ secretKey: "sk_test_" + "a".repeat(40), verify: async () => ({}) }));
});

test("the authenticator never calls Clerk without a bearer token and fails closed on every rejection", async () => {
  let verifyCalls = 0;
  const authenticate = createClerkPlatformAuthenticator({
    secretKey: "sk_test_" + "a".repeat(40),
    verify: async () => { verifyCalls += 1; throw new Error("token_expired"); },
  });
  assert.equal(await authenticate(requestWith({})), null);
  assert.equal(verifyCalls, 0, "no Authorization header must never reach Clerk verification");
  assert.equal(await authenticate(requestWith({ authorization: "Bearer aaa.bbb.ccc" })), null);
  assert.equal(verifyCalls, 1, "an expired/forged/invalid token must fail closed, not throw");
});

test("the authenticator returns a real principal only for a verified, organisation-scoped token", async () => {
  const authenticate = createClerkPlatformAuthenticator({
    secretKey: "sk_live_" + "b".repeat(40),
    verify: async (token) => {
      assert.equal(token, "header.payload.signature");
      return { sub: "user_42", org_id: "org_st-albans", org_role: "org:admin" };
    },
  });
  assert.deepEqual(await authenticate(requestWith({ authorization: "Bearer header.payload.signature" })),
    { organizationId: "org_st-albans", userId: "user_42" });
});

test("a verified personal-account token with no active organisation carries no authority", async () => {
  const authenticate = createClerkPlatformAuthenticator({
    secretKey: "sk_live_" + "c".repeat(40),
    verify: async () => ({ sub: "user_42" }),
  });
  assert.equal(await authenticate(requestWith({ authorization: "Bearer header.payload.signature" })), null);
});
