import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveDefaultUpdatePolicy,
  deriveDefaultUpdateTrack,
  normalizeAutoUpdateMode
} from "./lib/update-policy.js";
import { resolveRepoRoot } from "./lib/runtime-surfaces.js";

function parseArgs(argv: string[]) {
  const repoRoot = resolveRepoRoot(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  const args = {
    version: pkg.version,
    tag: `v${pkg.version}`,
    repo: process.env.GITHUB_REPOSITORY ?? "Juhwa-Lee1023/x-for-github-copilot",
    outputDir: path.join(repoRoot, "release-assets"),
    channel: "stable" as const,
    autoUpdateMode: normalizeAutoUpdateMode(process.env.XGC_AUTO_UPDATE_MODE),
    publishedAt: new Date().toISOString()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--version" && argv[index + 1]) {
      args.version = argv[index + 1];
      index += 1;
    } else if (current === "--tag" && argv[index + 1]) {
      args.tag = argv[index + 1];
      index += 1;
    } else if (current === "--repo" && argv[index + 1]) {
      args.repo = argv[index + 1];
      index += 1;
    } else if (current === "--output-dir" && argv[index + 1]) {
      args.outputDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--published-at" && argv[index + 1]) {
      args.publishedAt = argv[index + 1];
      index += 1;
    } else if (current === "--auto-update-mode" && argv[index + 1]) {
      args.autoUpdateMode = normalizeAutoUpdateMode(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const track = deriveDefaultUpdateTrack(args.version);
const updatePolicy = deriveDefaultUpdatePolicy(args.version);

const releaseManifest = {
  schemaVersion: 1,
  product: "xgc",
  repo: args.repo,
  version: args.version,
  tag: args.tag,
  channel: args.channel,
  track,
  updatePolicy,
  autoUpdateMode: args.autoUpdateMode,
  publishedAt: args.publishedAt,
  tarballUrl: `https://github.com/${args.repo}/archive/refs/tags/${args.tag}.tar.gz`,
  zipballUrl: `https://github.com/${args.repo}/archive/refs/tags/${args.tag}.zip`
};

const tracksManifest = {
  schemaVersion: 1,
  product: "xgc",
  repo: args.repo,
  generatedAt: args.publishedAt,
  channel: args.channel,
  latest: args.version,
  tracks: {
    [track]: {
      version: args.version,
      tag: args.tag,
      policy: updatePolicy
    }
  }
};

fs.mkdirSync(args.outputDir, { recursive: true });
fs.writeFileSync(path.join(args.outputDir, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
fs.writeFileSync(path.join(args.outputDir, "tracks.json"), `${JSON.stringify(tracksManifest, null, 2)}\n`);

console.log(`release manifest: ${path.join(args.outputDir, "release-manifest.json")}`);
console.log(`tracks manifest: ${path.join(args.outputDir, "tracks.json")}`);
