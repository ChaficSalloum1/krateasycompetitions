import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedModelCheck,
  modelCheckCriticalProtocols,
  type ProtocolModel,
} from "../src/index.js";

test("critical publication, idempotency and live-change protocols exhaust their bounded state spaces", () => {
  const report = modelCheckCriticalProtocols();

  assert.equal(report.status, "VERIFIED");
  assert.deepEqual(report.models.map(({ modelId }) => modelId), [
    "idempotent-command", "live-change-approval", "publication",
  ]);
  assert.ok(report.models.every(({ exploredStateCount, exploredTransitionCount }) => exploredStateCount > 1 && exploredTransitionCount > 1));
  assert.ok(report.models.every(({ violations }) => violations.length === 0));
  assert.deepEqual(modelCheckCriticalProtocols(), report);
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
});

test("bounded model checking returns the shortest concrete counterexample for an unsafe protocol", () => {
  type State = { published: boolean; certified: boolean };
  type Action = "CERTIFY" | "PUBLISH_UNSAFELY";
  const unsafe: ProtocolModel<State, Action> = {
    modelId: "unsafe-publication-example",
    initialState: { published: false, certified: false },
    actions: ["CERTIFY", "PUBLISH_UNSAFELY"],
    stateKey: (state) => JSON.stringify(state),
    actionKey: (action) => action,
    transition: (state, action) => action === "CERTIFY" ? { ...state, certified: true }
      : { ...state, published: true },
    invariants: [{ id: "PUBLISHED_IMPLIES_CERTIFIED", evaluate: (state) => !state.published || state.certified }],
  };
  const result = boundedModelCheck(unsafe, { maxDepth: 3 });

  assert.equal(result.status, "VIOLATED");
  assert.deepEqual(result.violations[0]?.actionTrace, ["PUBLISH_UNSAFELY"]);
  assert.deepEqual(result.violations[0]?.state, { published: true, certified: false });
});
