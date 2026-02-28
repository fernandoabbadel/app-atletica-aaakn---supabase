#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const args = process.argv.slice(2);
const rootArg = args.find((arg) => !arg.startsWith("--"));
const failOnMatch = args.includes("--fail-on-match");
const needle = "unoptimized";
const needlePattern = /\bunoptimized\b(?=$|[\s/>=])/;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const rootDir = path.resolve(cwd, rootArg ?? "src/app");

const normalizePath = (value) => value.replace(/\\/g, "/");

async function collectSourceFiles(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, files);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
}

async function run() {
  const files = [];
  await collectSourceFiles(rootDir, files);

  const matches = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const match = line.match(needlePattern);
      if (!match || match.index === undefined) {
        return;
      }

      matches.push({
        file,
        line: index + 1,
        column: match.index + 1,
        source: line.trim(),
      });
    });
  }

  if (matches.length === 0) {
    console.log(`No occurrences of "${needle}" found under ${normalizePath(path.relative(cwd, rootDir) || ".")}.`);
    return;
  }

  for (const match of matches) {
    const relativeFile = normalizePath(path.relative(cwd, match.file));
    console.log(`${relativeFile}:${match.line}:${match.column} ${match.source}`);
  }

  console.log(`\nFound ${matches.length} occurrence(s) of "${needle}".`);

  if (failOnMatch) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to scan for "${needle}": ${message}`);
  process.exitCode = 1;
});
