import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
    npmPackageSha256: null as string | null,
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
    } else if (current === "--npm-package-sha256" && argv[index + 1]) {
      args.npmPackageSha256 = argv[index + 1].toLowerCase();
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
const packageTarballName = `x-for-github-copilot-${args.version}.tgz`;
const packageTarballPath = path.join(args.outputDir, packageTarballName);

function sha256File(filePath: string) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

if (!args.npmPackageSha256 && fs.existsSync(packageTarballPath)) {
  args.npmPackageSha256 = sha256File(packageTarballPath);
}

if (args.npmPackageSha256 && !/^[a-f0-9]{64}$/i.test(args.npmPackageSha256)) {
  throw new Error(`Invalid --npm-package-sha256: ${args.npmPackageSha256}`);
}

const releaseManifest = {
  schemaVersion: 1,
  product: "xgc",
  npmPackage: "x-for-github-copilot",
  packageBin: "xgc",
  repo: args.repo,
  version: args.version,
  tag: args.tag,
  channel: args.channel,
  track,
  updatePolicy,
  autoUpdateMode: args.autoUpdateMode,
  publishedAt: args.publishedAt,
  installCommand: "npx x-for-github-copilot install",
  bunInstallCommand: "bunx x-for-github-copilot install",
  tarballUrl: `https://github.com/${args.repo}/releases/download/${args.tag}/${packageTarballName}`,
  sourceTarballUrl: `https://github.com/${args.repo}/archive/refs/tags/${args.tag}.tar.gz`,
  zipballUrl: `https://github.com/${args.repo}/archive/refs/tags/${args.tag}.zip`,
  npmPackageTarball: packageTarballName,
  npmPackageSha256: args.npmPackageSha256,
  installedRuntime: {
    prebuilt: true,
    runtimeDistDir: "runtime-dist",
    requiresNpmInstall: false
  }
};

const tracksManifest = {
  schemaVersion: 1,
  product: "xgc",
  npmPackage: "x-for-github-copilot",
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
