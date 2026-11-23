// Loads a `.pragma library` QML JS file into node as a module.
const fs = require("fs"), vm = require("vm"), path = require("path")
module.exports = function load(rel, extra) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const ctx = Object.assign({ Math, JSON, Date, console, Object, Array, String, Number, isFinite, parseInt, parseFloat }, extra || {})
  vm.createContext(ctx)
  vm.runInContext(src, ctx, { filename: rel })
  return ctx
}
