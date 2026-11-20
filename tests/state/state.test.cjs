// Dev-only tests for js/State.js. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const State = require("../../js/State.js");

const valid = {
  id: "snowman-1",
  monitor: "eDP-1",
  x: 100,
  y: 200,
  scale: 1,
  createdAt: 1700000000000
};

test("empty document is valid and round-trips", () => {
  const doc = State.empty();
  const parsed = State.normalize(doc);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.state.snowmen, []);
  assert.strictEqual(State.normalize(JSON.parse(State.serialize(doc))).ok, true);
});

test("a valid snowman is kept with exactly the known fields", () => {
  const parsed = State.normalize({ version: 1, snowmen: [valid], savedAt: 5 });
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(Object.keys(parsed.state.snowmen[0]).sort(), Object.keys(valid).sort());
  assert.strictEqual(parsed.state.snowmen[0].id, "snowman-1");
});

test("unknown fields on a snowman are dropped, not persisted", () => {
  const parsed = State.normalize({
    version: 1,
    snowmen: [Object.assign({}, valid, { exploded: true })],
    savedAt: 0
  });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual("exploded" in parsed.state.snowmen[0], false);
});

test("a wrong version is rejected rather than migrated", () => {
  const parsed = State.normalize({ version: 2, snowmen: [], savedAt: 0 });
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.reason, /version/);
  assert.deepStrictEqual(parsed.state.snowmen, []);
});

test("malformed documents are rejected and never partially applied", () => {
  const cases = [
    null,
    [],
    "text",
    { version: 1, snowmen: "nope" },
    { version: 1, snowmen: [null] },
    { version: 1, snowmen: [valid, { id: "x" }] },
    { version: 1, snowmen: [{ ...valid, x: "100" }] },
    { version: 1, snowmen: [{ ...valid, scale: 0 }] },
    { version: 1, snowmen: [{ ...valid, monitor: "" }] },
    { version: 1, snowmen: new Array(State.MAX_SNOWMEN + 1).fill(valid) }
  ];
  for (const doc of cases) {
    const parsed = State.normalize(doc);
    assert.strictEqual(parsed.ok, false, JSON.stringify(doc));
    assert.deepStrictEqual(parsed.state.snowmen, []);
    assert.ok(parsed.reason.length > 0);
  }
});

test("parse rejects invalid JSON without throwing", () => {
  const parsed = State.parse("{ not json");
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.reason, /JSON/);
});

test("parse accepts the serializer's own output", () => {
  const original = { version: 1, snowmen: [valid], savedAt: 7 };
  const parsed = State.parse(State.serialize(original));
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.state, original);
});

test("serialize of an invalid document writes a valid empty one, never the bad input", () => {
  const out = State.serialize({ version: 9, snowmen: [{ id: "" }] });
  const parsed = State.parse(out);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.state.snowmen, []);
});
