#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REPO = "Juhwa-Lee1023/x-for-github-copilot";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseSemver(input) {
  const match = String(input).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function deriveDefaultUpdateTrack(version) {
  const parsed = typeof version === "string" ? parseSemver(version) : version;
  if (!parsed) throw new Error(`Invalid semantic version: ${version}`);
  return parsed.major === 0 ? `0.${parsed.minor}` : String(parsed.major);
}

function deriveDefaultUpdatePolicy(version) {
  const parsed = typeof version === "string" ? parseSemver(version) : version;
  if (!parsed) throw new Error(`Invalid semantic version: ${version}`);
  return parsed.major === 0 ? "patch-within-track" : "minor-within-major";
}

function normalizeAutoUpdateMode(value) {
  return value === "off" || value === "check" || value === "apply" ? value : "check";
}

function isCompatibleUpdate({ current, candidate, track, policy }) {
  const currentVersion = typeof current === "string" ? parseSemver(current) : current;
  const candidateVersion = typeof candidate === "string" ? parseSemver(candidate) : candidate;
  if (!currentVersion || !candidateVersion) return false;
  if (compareSemver(candidateVersion, currentVersion) <= 0) return false;
  const effectivePolicy = policy || deriveDefaultUpdatePolicy(currentVersion);
  const effectiveTrack = track || deriveDefaultUpdateTrack(currentVersion);
  if (effectivePolicy === "patch-within-track") {
    return effectiveTrack === `${candidateVersion.major}.${candidateVersion.minor}`;
  }
  return effectiveTrack === String(candidateVersion.major);
}

function parseArgs(argv) {
  const args = {
    homeDir: os.homedir(),
    configHome: null,
    checkOnly: false,
    ifDue: false,
    quiet: false,
    repo: null,
    autoUpdateMode: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--check") {
      args.checkOnly = true;
    } else if (current === "--if-due") {
      args.ifDue = true;
    } else if (current === "--quiet") {
      args.quiet = true;
    } else if (current === "--home-dir" && argv[index + 1]) {
      args.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--config-home" && argv[index + 1]) {
      args.configHome = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--repo" && argv[index + 1]) {
      args.repo = argv[index + 1];
      index += 1;
    } else if (current === "--auto-update-mode" && argv[index + 1]) {
      args.autoUpdateMode = normalizeAutoUpdateMode(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function resolvePaths(args) {
  const configHome = args.configHome ?? path.join(args.homeDir, ".config", "xgc");
  return {
    configHome,
    installStatePath: path.join(configHome, "install-state.json"),
    shellEnvPath: path.join(configHome, "profile.env"),
    updaterPath: path.join(configHome, "xgc-update.mjs")
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchReleaseIndex(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: {
      "user-agent": "xgc-update"
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch releases for ${repo}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected releases payload for ${repo}`);
  }

  return payload
    .filter((entry) => !entry.draft && !entry.prerelease)
    .map((entry) => ({
      version: String(entry.tag_name ?? "").replace(/^v/, ""),
      tag: String(entry.tag_name ?? ""),
      tarballUrl: entry.tarball_url,
      publishedAt: entry.published_at ?? null
    }))
    .filter((entry) => parseSemver(entry.version) && entry.tag && entry.tarballUrl);
}

function selectLatestCompatibleRelease(releases, installState) {
  const compatibles = releases
    .filter((entry) =>
      isCompatibleUpdate({
        current: installState.version,
        candidate: entry.version,
        track: installState.updateTrack,
        policy: installState.updatePolicy
      })
    )
    .sort((left, right) => compareSemver(parseSemver(right.version), parseSemver(left.version)));

  return compatibles[0] ?? null;
}

function shouldSkipDueCheck(installState) {
  const lastCheck = installState.lastUpdateCheckAt ? Date.parse(installState.lastUpdateCheckAt) : NaN;
  return Number.isFinite(lastCheck) && Date.now() - lastCheck < CHECK_INTERVAL_MS;
}

function withCheckMetadata(installState, extra = {}) {
  return {
    ...installState,
    ...extra,
    lastUpdateCheckAt: new Date().toISOString()
  };
}

function readInstallState(paths) {
  const installState = readJsonIfExists(paths.installStatePath);
  if (!installState) {
    throw new Error(
      `Missing install state at ${paths.installStatePath}. Run bash scripts/install-global-xgc.sh --write-shell-profile first.`
    );
  }

  const version = installState.version;
  if (!parseSemver(version)) {
    throw new Error(`Install state is missing a valid version: ${paths.installStatePath}`);
  }

  return {
    ...installState,
    releaseRepo: installState.releaseRepo || DEFAULT_REPO,
    updateChannel: installState.updateChannel || "stable",
    updateTrack: installState.updateTrack || deriveDefaultUpdateTrack(version),
    updatePolicy: installState.updatePolicy || deriveDefaultUpdatePolicy(version),
    autoUpdateMode: normalizeAutoUpdateMode(installState.autoUpdateMode)
  };
}

function print(message, quiet) {
  if (!quiet) {
    console.log(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      [`${command} ${args.join(" ")}`, result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n")
    );
  }
  return result;
}

function updateInstallState(paths, current, patch) {
  writeJson(paths.installStatePath, { ...current, ...patch });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(args);
  const installState = readInstallState(paths);
  const repo = args.repo || installState.releaseRepo || DEFAULT_REPO;
  const backgroundMode = args.autoUpdateMode || installState.autoUpdateMode || "check";
  const effectiveMode = args.checkOnly ? "check" : args.ifDue ? backgroundMode : "apply";

  if (args.ifDue && shouldSkipDueCheck(installState)) {
    process.exit(0);
  }

  const releases = await fetchReleaseIndex(repo);
  const latestCompatible = selectLatestCompatibleRelease(releases, installState);
  const currentVersion = installState.version;

  if (!latestCompatible) {
    updateInstallState(paths, installState, withCheckMetadata(installState, {
      releaseRepo: repo,
      lastUpdateStatus: "up_to_date",
      lastKnownAvailableVersion: currentVersion
    }));
    print(`xgc update: ${currentVersion} is already the latest compatible release on track ${installState.updateTrack}.`, args.quiet);
    return;
  }

  if (effectiveMode === "check") {
    updateInstallState(paths, installState, withCheckMetadata(installState, {
      releaseRepo: repo,
      lastUpdateStatus: "update_available",
      lastKnownAvailableVersion: latestCompatible.version
    }));
    print(
      `xgc update: ${currentVersion} -> ${latestCompatible.version} is available on track ${installState.updateTrack} (${installState.updatePolicy}). Run xgc_update to apply it.`,
      args.quiet
    );
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xgc-update-"));
  const archivePath = path.join(tempRoot, "release.tar.gz");
  const response = await fetch(latestCompatible.tarballUrl, {
    headers: {
      "user-agent": "xgc-update"
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to download release tarball: ${response.status} ${response.statusText}`);
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, archiveBuffer);
  run("tar", ["-xzf", archivePath, "-C", tempRoot]);
  const extractedDir = fs
    .readdirSync(tempRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tempRoot, entry.name))
    .find((entry) => fs.existsSync(path.join(entry, "package.json")));

  if (!extractedDir) {
    throw new Error(`Unable to locate extracted release root in ${tempRoot}`);
  }

  print(`xgc update: applying ${currentVersion} -> ${latestCompatible.version}`, args.quiet);
  run("npm", ["ci"], { cwd: extractedDir });
  run(
    "npm",
    [
      "exec",
      "--yes",
      "--prefix",
      extractedDir,
      "--",
      "tsx",
      path.join(extractedDir, "scripts", "materialize-global-xgc.ts"),
      "--repo-root",
      extractedDir,
      "--home-dir",
      args.homeDir,
      "--permission-mode",
      installState.permissionMode || "ask",
      "--install-source",
      "release-artifact",
      "--release-repo",
      repo,
      "--release-tag",
      latestCompatible.tag,
      "--update-track",
      installState.updateTrack,
      "--update-channel",
      installState.updateChannel,
      "--auto-update-mode",
      backgroundMode
    ],
    { cwd: extractedDir }
  );

  const refreshed = readInstallState(paths);
  updateInstallState(paths, refreshed, {
    releaseRepo: repo,
    releaseTag: latestCompatible.tag,
    lastUpdateCheckAt: new Date().toISOString(),
    lastUpdateStatus: "updated",
    lastKnownAvailableVersion: latestCompatible.version,
    lastUpdatedFromVersion: currentVersion,
    lastUpdateAppliedAt: new Date().toISOString()
  });

  print(`xgc update: now on ${latestCompatible.version}`, args.quiet);
}

main().catch((error) => {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(args);
  try {
    const installState = readInstallState(paths);
    updateInstallState(paths, installState, withCheckMetadata(installState, {
      lastUpdateStatus: "failed"
    }));
  } catch {
    // Ignore state-write failures on the failure path.
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
