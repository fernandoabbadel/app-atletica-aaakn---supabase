import { rmSync } from "node:fs";
import { join } from "node:path";

const targets = [".next/dev", ".next/cache"];

for (const target of targets) {
  rmSync(join(process.cwd(), target), {
    recursive: true,
    force: true,
  });
}

console.log("[prepare-dev] cache de desenvolvimento limpo.");
