import { fileURLToPath } from "node:url";
import { resolveRepoRoot, syncRuntimeSurfaces } from "./lib/runtime-surfaces.js";

// Canonical source lives under source/.
// This script regenerates the runtime mirrors under agents/, skills/, and .github/.

const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

try {
  const results = await syncRuntimeSurfaces(repoRoot, { check });
  for (const result of results) {
    const verb = check ? "verified" : "generated";
    console.log(`${verb}: ${result.source} -> ${result.target}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
