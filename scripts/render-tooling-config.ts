import fs from "node:fs";
import { writeToolingArtifacts, type ToolingSpec } from "./lib/tooling-config.js";

const specPath = process.argv[2];

if (!specPath) {
  console.error("Usage: npm exec -- tsx scripts/render-tooling-config.ts <spec.json>");
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as ToolingSpec;
writeToolingArtifacts(spec);
