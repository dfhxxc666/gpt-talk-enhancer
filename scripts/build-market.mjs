import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleFile = path.join(root, "dist", "v3", "00-gpt-talk-enhancer.v3.bundle.js");
const loaderFile = path.join(root, "dist", "v3", "10-gpt-talk-enhancer.v3.loader.js");
const outDir = path.join(root, "dist", "market");
const outFile = path.join(outDir, "gpt-talk-enhancer.js");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

for (const file of [bundleFile, loaderFile]) {
  if (!fs.existsSync(file)) throw new Error(`Missing v3 build artifact: ${path.relative(root, file)}`);
}

const header = `/*\n@codex-plus-script\nname: GPT TalkEnhancer\ndescription: Conversation Timeline / Question List and Prompt Library for Codex Desktop.\nversion: ${packageJson.version}\nauthor: dfhxxc666\nhomepage: https://github.com/dfhxxc666/gpt-talk-enhancer\nlicense: GPL-3.0-or-later\n\nGPT TalkEnhancer includes GPL-derived Timeline / Question List work.\nSee the project NOTICE.md and LICENSE for attribution and license details.\n*/\n\n`;
const bundle = fs.readFileSync(bundleFile, "utf8").trimEnd();
const loader = fs.readFileSync(loaderFile, "utf8").trim();
const output = `${header}${bundle}\n\n${loader}\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, output, "utf8");
console.log(`Built ${path.relative(root, outFile)} (${Buffer.byteLength(output, "utf8")} bytes)`);