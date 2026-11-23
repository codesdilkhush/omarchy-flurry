const test = require("node:test")
const assert = require("node:assert")
const S = require("./load")("lib/store.js", { encodeURIComponent, decodeURIComponent })

test("garbage state normalizes to defaults", () => {
  for (const raw of [null, 42, "x", { effect: "lava", intensity: 99, trees: "no" }]) {
    const s = S.normalize(raw)
    assert.ok(S.EFFECTS.includes(s.effect))
    assert.ok(s.intensity >= 0.25 && s.intensity <= 2)
    assert.ok(Array.isArray(s.trees))
  }
})

test("limits hold", () => {
  const many = Array.from({ length: 50 }, () => ({}))
  const s = S.normalize({ trees: many, snowmen: many, gifts: many })
  assert.strictEqual(s.trees.length, S.MAX_TREES)
  assert.strictEqual(s.snowmen.length, S.MAX_SNOWMEN)
  assert.strictEqual(s.gifts.length, S.MAX_GIFTS)
})

test("friend codes round-trip and reject junk", () => {
  const me = { id: "0123456789abcdef0123456789abcdef", name: "Saman S" }
  const code = S.friendCode(me)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(S.parseFriendCode(code))), { name: "Saman S", id: me.id })
  for (const bad of ["", "flurry1:x:123", "flurry1::0123456789abcdef0123456789abcdef", "nope", "flurry1:a:" + "g".repeat(32)])
    assert.strictEqual(S.parseFriendCode(bad), null)
})

test("only https servers are accepted", () => {
  assert.strictEqual(S.normalize({ server: "http://evil" }).server, S.DEFAULT_SERVER)
  assert.strictEqual(S.normalize({ server: "https://ntfy.example.com/" }).server, "https://ntfy.example.com")
  assert.strictEqual(S.normalize({ server: "https://x.com/$(rm -rf ~)" }).server, S.DEFAULT_SERVER)
})

test("inbox lines are validated", () => {
  const me = { id: "0123456789abcdef0123456789abcdef", name: "A" }
  const msg = S.giftMessage(me, "snowman", { scarf: "#2980b9", size: 1.2 })
  const line = JSON.stringify({ event: "message", id: "abc123", message: JSON.stringify(msg) })
  const got = S.parseInbox(line, [{ id: me.id, name: "Ali" }])
  assert.strictEqual(got.gift.kind, "snowman")
  assert.strictEqual(got.gift.from, "Ali")
  assert.strictEqual(got.gift.known, true)
  assert.strictEqual(S.parseInbox(JSON.stringify({ event: "keepalive" }), []), null)
  assert.strictEqual(S.parseInbox("not json", []), null)
  const evil = JSON.stringify({ event: "message", id: "x", message: JSON.stringify(Object.assign({}, msg, { kind: "exec" })) })
  assert.strictEqual(S.parseInbox(evil, []), null)
  const huge = JSON.stringify({ event: "message", id: "x", message: "x".repeat(20000) })
  assert.strictEqual(S.parseInbox(huge, []), null)
})

test("a received tree with junk ornaments is cleaned", () => {
  const t = S.normalizeTree({ ornaments: [{ kind: "bomb", u: 9, v: -3, color: "red;" }] })
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.ornaments[0])), { kind: "bauble", u: 1, v: 0, color: S.BAUBLE_COLORS[0] })
})

test("window light strings normalize and are capped", () => {
  const s = S.normalize({ strings: [{ windowClass: "kitty", palette: "multi" }, { windowClass: "", palette: "warm" },
    { windowClass: "firefox", palette: "lava" }, null].concat(Array.from({ length: 20 }, (_, i) => ({ windowClass: "c" + i }))) })
  assert.strictEqual(s.strings.length, S.MAX_STRINGS)
  assert.strictEqual(s.strings[0].windowClass, "kitty")
  assert.strictEqual(s.strings[0].palette, "multi")
  assert.strictEqual(s.strings[1].palette, "warm")
  assert.ok(/^[a-z0-9]+$/i.test(s.strings[0].id))
  assert.deepStrictEqual(S.normalize({}).strings, [])
})
