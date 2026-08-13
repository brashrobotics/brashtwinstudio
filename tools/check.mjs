import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const ignoredDirectories = new Set(["node_modules", ".git", ".local", "dist", "coverage"]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

const rootPath = root.pathname;
const files = await listFiles(rootPath);
const failures = [];

for (const file of files) {
  if (extname(file) === ".js" || extname(file) === ".mjs") {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) failures.push(`${relative(rootPath, file)}: ${result.stderr.trim()}`);
  }
  if (extname(file) === ".json") {
    try {
      JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      failures.push(`${relative(rootPath, file)}: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} repository files.`);
}
