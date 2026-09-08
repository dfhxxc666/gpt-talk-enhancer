import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src", "v3", "bootstrap.js");
const outDir = path.join(root, "dist", "v3");
const bundleFile = path.join(outDir, "00-gpt-talk-enhancer.v3.bundle.js");
const loaderSource = path.join(root, "integration", "codex-plus", "loader.js");
const loaderFile = path.join(outDir, "10-gpt-talk-enhancer.v3.loader.js");
const noticeSource = path.join(root, "reference", "NOTICE-GPL.md");
const licenseSource = path.join(root, "reference", "THIRD_PARTY_GPL-3.0.txt");
const timelineCss = path.join(root, "src", "v3", "ui", "timeline", "timeline.css");
const promptCss = path.join(root, "src", "v3", "ui", "prompt", "prompt.css");
const STYLE_PLACEHOLDER = "__GTE_V3_CSS_BUNDLE_PLACEHOLDER__";

const modules = new Map();

function moduleId(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) throw new Error(`Only relative imports are allowed in v3 bundle: ${specifier}`);
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

function collect(file) {
  const absolute = path.resolve(file);
  const id = moduleId(absolute);
  if (modules.has(id)) return id;
  let source = fs.readFileSync(absolute, "utf8");
  const dependencies = [];
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g, (_full, names, specifier) => {
    const depFile = resolveImport(absolute, specifier);
    const depId = collect(depFile);
    dependencies.push(depId);
    return `const { ${names.trim()} } = __require(${JSON.stringify(depId)});`;
  });

  const exports = [];
  source = source.replace(/export\s+(class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_full, kind, name) => {
    exports.push(name);
    return `${kind} ${name}`;
  });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_full, names) => {
    for (const part of names.split(",")) {
      const local = part.trim().split(/\s+as\s+/i)[0];
      if (local) exports.push(local);
    }
    return "";
  });
  const uniqueExports = [...new Set(exports)];
  if (uniqueExports.length) source += `\nObject.assign(exports, { ${uniqueExports.join(", ")} });\n`;
  modules.set(id, source);
  return id;
}

const entryId = collect(entry);
let body = "";
for (const [id, source] of modules) {
  body += `${JSON.stringify(id)}: (module, exports, __require) => {\n${source}\n},\n`;
}

let bundle = `/*\n * GPT TalkEnhancer 0.5.1 Desktop bundle\n * Includes GPL-3.0-or-later derived Timeline UI material.\n * See NOTICE-GPL.md and THIRD_PARTY_GPL-3.0.txt in this distribution.\n */\n(() => {\n  \"use strict\";\n  const __modules = {\n${body}  };\n  const __cache = Object.create(null);\n  function __require(id) {\n    if (__cache[id]) return __cache[id].exports;\n    const factory = __modules[id];\n    if (!factory) throw new Error(\`Missing bundled module: \${id}\`);\n    const module = { exports: {} };\n    __cache[id] = module;\n    factory(module, module.exports, __require);\n    return module.exports;\n  }\n  __require(${JSON.stringify(entryId)});\n})();\n`;

const css = `${fs.readFileSync(timelineCss, "utf8")}\n${fs.readFileSync(promptCss, "utf8")}`;
bundle = bundle.replace(JSON.stringify(STYLE_PLACEHOLDER), JSON.stringify(css));
if (bundle.includes(STYLE_PLACEHOLDER)) throw new Error("CSS placeholder was not fully replaced");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(bundleFile, bundle, "utf8");
fs.copyFileSync(loaderSource, loaderFile);
fs.copyFileSync(noticeSource, path.join(outDir, "NOTICE-GPL.md"));
fs.copyFileSync(licenseSource, path.join(outDir, "THIRD_PARTY_GPL-3.0.txt"));
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({
  name: "gpt-talk-enhancer-v3-codex-plus",
  version: "0.5.1",
  host: "codex-desktop",
  codexPlus: {
    minimumConfirmedVersion: "1.2.56",
    files: [path.basename(bundleFile), path.basename(loaderFile)]
  }
}, null, 2) + "\n", "utf8");

console.log(`Built ${path.relative(root, bundleFile)} (${Buffer.byteLength(bundle, "utf8")} bytes)`);
console.log(`Built ${path.relative(root, loaderFile)} (thin loader)`);
