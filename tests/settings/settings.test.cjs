// Dev-only tests for js/Settings.js. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const Settings = require("../../js/Settings.js");

test("normalize fills every key from defaults", () => {
  const s = Settings.normalize(undefined);
  assert.deepStrictEqual(Object.keys(s).sort(), Object.keys(Settings.DEFAULTS).sort());
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.overlay, "passive");
  assert.strictEqual(s.layer, "behind");
  assert.strictEqual(s.quality, "balanced");
  assert.strictEqual(s.density, 1);
  assert.strictEqual(s.wind, 1);
  assert.strictEqual(s.accumulateOnWindows, true);
  assert.strictEqual(s.builderEnabled, true);
});

test("normalize rejects wrong types by falling back, never throwing", () => {
  const s = Settings.normalize({
    enabled: "yes",
    overlay: 7,
    layer: "middle",
    quality: "ultra",
    density: "1.5",
    wind: null,
    accumulateOnWindows: 0,
    builderEnabled: undefined
  });
  assert.strictEqual(s.enabled, Settings.DEFAULTS.enabled);
  assert.strictEqual(s.overlay, Settings.DEFAULTS.overlay);
  assert.strictEqual(s.layer, Settings.DEFAULTS.layer);
  assert.strictEqual(s.quality, Settings.DEFAULTS.quality);
  assert.strictEqual(s.density, Settings.DEFAULTS.density);
  assert.strictEqual(s.wind, Settings.DEFAULTS.wind);
  assert.strictEqual(s.accumulateOnWindows, Settings.DEFAULTS.accumulateOnWindows);
  assert.strictEqual(s.builderEnabled, Settings.DEFAULTS.builderEnabled);
});

test("normalize clamps numbers instead of accepting them", () => {
  assert.strictEqual(Settings.normalize({ density: 99 }).density, Settings.DENSITY_MAX);
  assert.strictEqual(Settings.normalize({ density: -5 }).density, Settings.DENSITY_MIN);
  assert.strictEqual(Settings.normalize({ wind: 99 }).wind, Settings.WIND_MAX);
  assert.strictEqual(Settings.normalize({ wind: -99 }).wind, Settings.WIND_MIN);
  assert.strictEqual(Settings.normalize({ density: NaN }).density, 1);
  assert.strictEqual(Settings.normalize({ density: Infinity }).density, 1);
});

test("normalize drops unknown keys so stale settings cannot round-trip", () => {
  const s = Settings.normalize({ enabled: true, legacySled: true, id: "snowglobe" });
  assert.strictEqual("legacySled" in s, false);
  assert.strictEqual("id" in s, false);
});

test("normalize rejects arrays and primitives as the document", () => {
  for (const raw of [[], "x", 3, true, null]) {
    const s = Settings.normalize(raw);
    assert.strictEqual(s.overlay, "passive");
    assert.strictEqual(s.enabled, true);
  }
});

test("toEntry keeps the id and stays a valid settings object", () => {
  const entry = Settings.toEntry({ density: 2 }, "snowglobe");
  assert.strictEqual(entry.id, "snowglobe");
  assert.strictEqual(entry.density, 2);
  assert.strictEqual(Settings.normalize(entry).density, 2);
});

test("overlayWanted is false when disabled or when the overlay mode is disabled", () => {
  assert.strictEqual(Settings.overlayWanted({ enabled: true, overlay: "passive" }), true);
  assert.strictEqual(Settings.overlayWanted({ enabled: false, overlay: "passive" }), false);
  assert.strictEqual(Settings.overlayWanted({ enabled: true, overlay: "disabled" }), false);
});

test("normalize is idempotent", () => {
  const once = Settings.normalize({ density: 2.5, wind: -1, quality: "high" });
  const twice = Settings.normalize(once);
  assert.deepStrictEqual(twice, once);
});
