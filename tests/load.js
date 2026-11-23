// Loads a `.pragma library` QML JS file into node as a module. The file is
// compiled as a plain function in this context (a vm context would route
// every global lookup through a proxy and run the simulation ~10x slower),
// and every top-level function and var is returned.
const fs = require("fs"), path = require("path")
module.exports = function load(rel, extra) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8")
    .replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  const params = Object.keys(extra || {})
  const body = src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}"
  return new Function(...params, body)(...params.map(k => extra[k]))
}
