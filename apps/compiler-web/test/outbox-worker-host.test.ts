import assert from "node:assert/strict";
import test from "node:test";
import { createOutboxWorkerHost } from "../src/outbox-worker-host.js";

const validEnv = {
  DATABASE_URL: "postgresql://user@localhost:5432/db",
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_ADDRESS: "notices@krateasy.example",
};

function fakePool() {
  let ended = 0;
  const pool = {
    async connect(): Promise<never> { throw new Error("connect() must not be called by these tests"); },
    async end() { ended += 1; },
  };
  return { pool, endedCount: () => ended };
}

for (const key of Object.keys(validEnv)) {
  test(`createOutboxWorkerHost fails closed when ${key} is missing`, async () => {
    const { pool } = fakePool();
    const remaining = Object.fromEntries(Object.entries(validEnv).filter(([candidate]) => candidate !== key));
    await assert.rejects(createOutboxWorkerHost({ tenantId: "org.one", workerId: "worker.1" },
      { env: remaining, pool }), new RegExp(key));
  });
}

test("with full configuration it returns a runnable, closeable host wired to the injected pool", async () => {
  const { pool, endedCount } = fakePool();
  const host = await createOutboxWorkerHost({ tenantId: "org.one", workerId: "worker.1" }, { env: validEnv, pool });
  assert.equal(typeof host.runOnce, "function");
  assert.equal(typeof host.close, "function");
  await host.close();
  assert.equal(endedCount(), 1);
});
