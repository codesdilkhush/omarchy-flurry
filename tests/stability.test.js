// Step 1 (stability) regression tests.
//
// Each test pins one defect that existed in 1.1.1, or one consistency rule that
// would have caught it. They are plain file/JSON checks: no desktop needed.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const Settings = require(path.join(root, "js/Settings.js"));
const Constants = require(path.join(root, "js/Constants.js"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "svc") continue;
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---- settings persistence -------------------------------------------------

test("toEntry round-trips every setting (plowEnabled used to be dropped)", () => {
  const changed = {
    enabled: false, overlay: "disabled", layer: "behind", quality: "high",
    density: 2.5, wind: -1.5, accumulateOnWindows: false, builderEnabled: false,
    adaptiveQuality: false, pauseOnFullscreen: false, plowEnabled: false,
    transparencyGuard: false
  };
  // Guard: the fixture must cover every key, or a new setting would escape it.
  assert.deepStrictEqual(Object.keys(changed).sort(), Object.keys(Settings.DEFAULTS).sort());
  const entry = Settings.toEntry(changed, "snowglobe");
  for (const key of Object.keys(changed))
    assert.strictEqual(entry[key], changed[key], key + " must survive toEntry");
  assert.strictEqual(entry.id, "snowglobe");
  assert.strictEqual(entry.settingsRevision, Settings.SETTINGS_REVISION);
});

test("a stored entry re-normalizes to itself (idempotent write)", () => {
  const once = Settings.toEntry({ plowEnabled: false, quality: "low" }, "snowglobe");
  const twice = Settings.toEntry(once, "snowglobe");
  assert.deepStrictEqual(twice, once);
});

test("toEntry still clamps and defaults bad input", () => {
  const entry = Settings.toEntry({ density: 99, wind: "x", quality: "ultra", plowEnabled: "yes" }, "snowglobe");
  assert.strictEqual(entry.density, Settings.DENSITY_MAX);
  assert.strictEqual(entry.wind, Settings.DEFAULTS.wind);
  assert.strictEqual(entry.quality, Settings.DEFAULTS.quality);
  assert.strictEqual(entry.plowEnabled, Settings.DEFAULTS.plowEnabled);
});

// ---- manifest consistency --------------------------------------------------

test("manifest defaults cover exactly the keys Settings knows about", () => {
  const defaults = manifest.barWidget.defaults;
  for (const key of Object.keys(Settings.DEFAULTS))
    assert.ok(key in defaults, "manifest defaults is missing " + key);
  for (const key of Object.keys(defaults))
    assert.ok(key in Settings.DEFAULTS, "manifest defaults has unknown key " + key);
});

test("manifest defaults equal Settings.DEFAULTS values", () => {
  const defaults = manifest.barWidget.defaults;
  for (const key of Object.keys(Settings.DEFAULTS))
    assert.strictEqual(defaults[key], Settings.DEFAULTS[key], key);
});

test("every schema field has a default that matches and valid enum options", () => {
  const enums = { overlay: Settings.OVERLAY_MODES, layer: Settings.LAYERS, quality: Settings.QUALITIES };
  const seen = new Set();
  for (const field of manifest.barWidget.schema) {
    assert.ok(!seen.has(field.key), "duplicate schema key " + field.key);
    seen.add(field.key);
    assert.ok(field.key in Settings.DEFAULTS, "schema key not in Settings: " + field.key);
    assert.strictEqual(field.defaultValue, Settings.DEFAULTS[field.key], field.key + " defaultValue");
    if (field.type === "enum") {
      assert.deepStrictEqual(field.options, enums[field.key], field.key + " options");
    }
  }
  assert.ok(seen.has("plowEnabled"), "plowEnabled must be configurable from the schema");
});

// ---- version / constants consistency ---------------------------------------

test("manifest, Constants and CHANGELOG agree on the version", () => {
  assert.strictEqual(Constants.SERVICE_VERSION, manifest.version);
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const first = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(first, "CHANGELOG has no release heading");
  assert.strictEqual(first[1], manifest.version);
});

test("Constants no longer carries a stale copy of the state schema version", () => {
  assert.strictEqual(Constants.STATE_VERSION, undefined);
  assert.strictEqual(Constants.MAX_STATE_BYTES, undefined);
});

// ---- static source audits ---------------------------------------------------

test("every literal strings.t() key exists in the i18n catalog", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  const files = walk(root).filter((f) => f.endsWith(".qml") && !f.includes(path.join("tests", "qml")));
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // Plain literals: t("a.b"). Dynamic prefixes ("a." + x) and ternaries are
    // checked against their literal branches by the second pattern.
    for (const m of src.matchAll(/strings\.t\(\s*"([^"]+)"\s*\)/g))
      if (!(m[1] in catalog)) missing.push(path.relative(root, file) + ": " + m[1]);
    for (const m of src.matchAll(/\?\s*"((?:bar|builder|row|diag|value|section)\.[A-Za-z.]+)"\s*:\s*"((?:bar|builder|row|diag|value|section)\.[A-Za-z.]+)"/g)) {
      if (!(m[1] in catalog)) missing.push(path.relative(root, file) + ": " + m[1]);
      if (!(m[2] in catalog)) missing.push(path.relative(root, file) + ": " + m[2]);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test("QML JavaScript modules use no ES module syntax (not supported by QML)", () => {
  for (const file of walk(path.join(root, "js")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(!/^\s*import\s/m.test(src), path.basename(file) + " uses import");
    assert.ok(!/^\s*export\s/m.test(src), path.basename(file) + " uses export");
  }
});

test("every js module imported from QML exists", () => {
  const files = walk(root).filter((f) => f.endsWith(".qml") && !f.includes(path.join("tests", "qml")));
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s+"([^"]+\.js)"\s+as\s+\w+/gm)) {
      const target = path.resolve(path.dirname(file), m[1]);
      assert.ok(fs.existsSync(target), path.relative(root, file) + " imports missing " + m[1]);
    }
  }
});

test("idle full-screen canvases are gated (tracks and plough)", () => {
  const scene = fs.readFileSync(path.join(root, "qml/MonitorScene.qml"), "utf8");
  const tick = scene.slice(scene.indexOf("onTriggered: {"), scene.indexOf("onSimulationChanged"));
  assert.ok(tick.length > 50, "could not isolate the tick handler");
  assert.ok(/if \(tracks\.wantsPaint\(\)\) tracks\.requestPaint\(\)/.test(tick), "tracks must be gated");
  assert.ok(/if \(plowLayer\.wantsPaint\(\)\) plowLayer\.requestPaint\(\)/.test(tick), "plough must be gated");
  assert.ok(!/^\s*(tracks|plowLayer)\.requestPaint\(\)\s*$/m.test(tick), "no unconditional repaint in the tick");
});

test("every setting is reachable from the settings panel (or explicitly deferred)", () => {
  // density and wind have no control yet; Step 6 (mode menu: Snow / Heavy snow)
  // gives them one. Remove them from this list then. Anything else without a UI
  // is a bug: plowEnabled shipped like that in 1.1.1.
  const deferred = new Set(["density", "wind"]);
  const panel = fs.readFileSync(path.join(root, "Panel.qml"), "utf8");
  const missing = Object.keys(Settings.DEFAULTS).filter(
    (key) => !deferred.has(key) && !new RegExp("cfg\\." + key + "\\b").test(panel));
  assert.deepStrictEqual(missing, []);
});
