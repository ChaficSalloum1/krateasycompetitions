import assert from "node:assert/strict";
import test from "node:test";
import { createRegisteredRandomSource } from "../src/random.js";

test("registered random algorithms are versioned, deterministic, and semantically distinct", () => {
  const sequence = (algorithm: "xoshiro128ss" | "pcg32") => {
    const source = createRegisteredRandomSource({ algorithm, seed: "draw-42" });
    return { metadata: source.metadata, values: Array.from({ length: 8 }, () => source.nextUint32()) };
  };

  const xoshiro = sequence("xoshiro128ss");
  const pcg = sequence("pcg32");

  assert.deepEqual(sequence("xoshiro128ss"), xoshiro);
  assert.deepEqual(sequence("pcg32"), pcg);
  assert.notDeepEqual(xoshiro.values, pcg.values);
  assert.deepEqual(xoshiro.values, [3751643258, 168171059, 1266518159, 1027499891, 1501454731, 2560365478, 1707892678, 1261110982]);
  assert.deepEqual(pcg.values, [8502825, 2033706639, 3308965119, 517460367, 1292260288, 2466962939, 625240540, 1090452581]);
  assert.equal(xoshiro.metadata.version, "1.0.0");
  assert.match(xoshiro.metadata.seedHash, /^[a-f0-9]{64}$/);
});
