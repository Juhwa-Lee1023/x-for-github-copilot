import test from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  deriveDefaultUpdatePolicy,
  deriveDefaultUpdateTrack,
  isCompatibleUpdate,
  parseSemver,
  selectLatestCompatibleVersion
} from "../scripts/lib/update-policy.js";

test("update policy derives patch-only track for 0.x releases", () => {
  assert.deepEqual(parseSemver("0.1.7"), { major: 0, minor: 1, patch: 7 });
  assert.equal(deriveDefaultUpdateTrack("0.1.7"), "0.1");
  assert.equal(deriveDefaultUpdatePolicy("0.1.7"), "patch-within-track");
});

test("update policy derives same-major minor policy for 1.x releases", () => {
  assert.equal(deriveDefaultUpdateTrack("1.4.2"), "1");
  assert.equal(deriveDefaultUpdatePolicy("1.4.2"), "minor-within-major");
});

test("update compatibility keeps 0.x installs within the same minor track", () => {
  assert.equal(
    isCompatibleUpdate({
      current: "0.1.2",
      candidate: "0.1.9",
      track: "0.1",
      policy: "patch-within-track"
    }),
    true
  );
  assert.equal(
    isCompatibleUpdate({
      current: "0.1.2",
      candidate: "0.2.0",
      track: "0.1",
      policy: "patch-within-track"
    }),
    false
  );
});

test("update compatibility keeps 1.x installs within the same major line", () => {
  assert.equal(
    isCompatibleUpdate({
      current: "1.2.3",
      candidate: "1.5.0",
      track: "1",
      policy: "minor-within-major"
    }),
    true
  );
  assert.equal(
    isCompatibleUpdate({
      current: "1.2.3",
      candidate: "2.0.0",
      track: "1",
      policy: "minor-within-major"
    }),
    false
  );
});

test("latest compatible selection prefers the highest compatible release only", () => {
  const latest = selectLatestCompatibleVersion(
    [
      { version: "0.1.3" },
      { version: "0.2.0" },
      { version: "0.1.9" }
    ],
    { current: "0.1.2", track: "0.1", policy: "patch-within-track" }
  );
  assert.deepEqual(latest, { version: "0.1.9" });
  assert.ok(compareSemver(parseSemver("1.0.1")!, parseSemver("1.0.0")!) > 0);
});
