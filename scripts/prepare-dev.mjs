import { rmSync } from "node:fs";
import { join } from "node:path";

const shouldClearNextCache =
  process.env.CLEAR_NEXT_CACHE === "1" ||
  process.env.CLEAR_NEXT_CACHE === "true";
const targets = [".next/dev"];

if (shouldClearNextCache) {
  targets.push(".next/cache");
}

for (const target of targets) {
  rmSync(join(process.cwd(), target), {
    recursive: true,
    force: true,
  });
}

console.log(
  shouldClearNextCache
    ? "[prepare-dev] .next/dev e .next/cache limpos."
    : "[prepare-dev] .next/dev limpo; preservando .next/cache para acelerar o webpack."
);
