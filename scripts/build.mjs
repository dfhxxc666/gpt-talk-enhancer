import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryFile = resolve(projectRoot, "src/userscript.js");
const modules = new Map();

await collectModule(entryFile);
const captureSource = (await readFile(resolve(projectRoot, "extension/main/chatgpt-api-capture.js"), "utf8")).replace(/\r\n?/g, "\n");

const bundle = [
  "// ==UserScript==",
  "// @name         GPT TalkEnhancer",
  "// @namespace    https://github.com/dfhxxc666/gpt-talk-enhancer",
  "// @version      0.2.0",
  "// @description  Extension-derived Conversation Timeline and Prompt Library for Codex++.",
  "// @match        https://chatgpt.com/*",
  "// @match        https://chat.openai.com/*",
  "// @run-at       document-start",
  "// @grant        none",
  "// ==/UserScript==",
  "",
  "// GPL-derived ChatGPT conversation capture; see extension/NOTICE.md.",
  captureSource,
  "",
  ";(() => {",
  "  const __modules = {",
  ...[...modules.entries()].map(([id, module]) => `    ${JSON.stringify(id)}: (exports, __require) => {\n${indent(module.code, 6)}\n      return exports;\n    },`),
  "  };",
  "  const __cache = Object.create(null);",
  "  const __require = (id) => {",
  "    if (__cache[id]) return __cache[id];",
  "    const factory = __modules[id];",
  "    if (!factory) throw new Error(`GPT TalkEnhancer module not found: ${id}`);",
  "    const exports = {};",
  "    __cache[id] = exports;",
  "    factory(exports, __require);",
  "    return exports;",
  "  };",
  `  __require(${JSON.stringify(toModuleId(entryFile))});`,
  "})();",
  ""
].join("\n");

const outputDirectory = resolve(projectRoot, "dist");
const outputFile = resolve(outputDirectory, "gpt-talk-enhancer.user.js");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, bundle, "utf8");
console.log(`Built ${relative(projectRoot, outputFile)} (${modules.size} modules, ${bundle.length} bytes)`);

async function collectModule(filePath) {
  const id = toModuleId(filePath);
  if (modules.has(id)) return;
  const source = await readFile(filePath, "utf8");
  const imports = [];
  let code = source.replace(/^\s*import\s+\{([^}]+)\}\s+from\s+["'](.+?)["'];?\s*$/gm, (_match, specifiers, request) => {
    const dependency = resolveImport(filePath, request);
    imports.push(dependency);
    const bindings = specifiers.split(",").map((specifier) => specifier.trim()).filter(Boolean).map((specifier) => {
      const [imported, local] = specifier.split(/\s+as\s+/);
      return local ? `${imported.trim()}: ${local.trim()}` : imported.trim();
    });
    return `const { ${bindings.join(", ")} } = __require(${JSON.stringify(toModuleId(dependency))});`;
  });

  code = code.replace(/^\s*export\s+\*\s+from\s+["'](.+?)["'];?\s*$/gm, (_match, request) => {
    const dependency = resolveImport(filePath, request);
    imports.push(dependency);
    return `Object.assign(exports, __require(${JSON.stringify(toModuleId(dependency))}));`;
  });

  const exportedNames = new Set();
  code = code.replace(/\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)/g, (_match, name) => {
    exportedNames.add(name);
    return `async function ${name}`;
  });
  code = code.replace(/\bexport\s+(?=(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*))/g, (_match, name) => {
    exportedNames.add(name);
    return "";
  });
  code = code.replace(/^\s*export\s*\{([^}]+)\};?\s*$/gm, (_match, names) => {
    for (const name of names.split(",")) {
      const [local, exported] = name.trim().split(/\s+as\s+/);
      if (!local) continue;
      exportedNames.add(exported?.trim() || local.trim());
      if (exported) {
        code += `\nexports[${JSON.stringify(exported.trim())}] = ${local.trim()};`;
      }
    }
    return "";
  });

  for (const dependency of imports) {
    await collectModule(dependency);
  }
  for (const name of exportedNames) {
    code += `\nexports[${JSON.stringify(name)}] = ${name};`;
  }
  modules.set(id, { code });
}

function resolveImport(fromFile, request) {
  const resolved = resolve(dirname(fromFile), request);
  return extname(resolved) ? resolved : `${resolved}.js`;
}

function toModuleId(filePath) {
  return relative(projectRoot, filePath).split(sep).join("/");
}

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line ? `${prefix}${line}` : "").join("\n");
}
