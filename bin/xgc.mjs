#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "x-for-github-copilot";
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const packageVersion = packageJson.version;
const allowedPayloadRoots = new Set([
  ".github",
  "agents",
  "bin",
  "docs",
  "hooks",
  "runtime-dist",
  "scripts",
  "skills",
  "source",
  "CONTRIBUTING.md",
  "KNOWN_RISKS.md",
  "LICENSE",
  "MIGRATION_NOTES.md",
  "PORTING_NOTES.md",
  "README.md",
  "SECURITY.md",
  "UPSTREAM.md",
  "lsp.json",
  "package.json",
  "plugin.json"
]);

function requireRuntimeEntry(compiledName) {
  const compiledPath = path.join(packageRoot, "runtime-dist", compiledName);
  if (fs.existsSync(compiledPath)) {
    return compiledPath;
  }
  console.error(`Missing prebuilt runtime entry: ${compiledPath}`);
  console.error("Run: npm run generate:runtime-dist before packaging or reinstall the release package.");
  process.exit(1);
}

function resolvePaths(homeDir = os.homedir()) {
  const runtimeHome = path.join(homeDir, ".local", "share", "xgc");
  return {
    homeDir,
    configHome: path.join(homeDir, ".config", "xgc"),
    installStatePath: path.join(homeDir, ".config", "xgc", "install-state.json"),
    runtimeHome,
    runtimeReleasesHome: path.join(runtimeHome, "releases"),
    runtimeCurrentPath: path.join(runtimeHome, "current"),
    runtimeCurrentBinPath: path.join(runtimeHome, "current", "bin", "xgc.mjs")
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: packageRoot,
    env: process.env,
    ...options
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function realpathSafe(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function parseSemver(input) {
  return /^v?\d+\.\d+\.\d+$/.test(String(input).trim());
}

function assertPathInside(parent, candidate, label) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedParent && !resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`${label} escapes expected root: ${candidate}`);
  }
}

function normalizePayloadPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`Invalid package payload path: ${String(relativePath)}`);
  }
  if (relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe package payload path: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe package payload path: ${relativePath}`);
  }
  const topLevel = normalized.split("/")[0];
  if (!allowedPayloadRoots.has(topLevel)) {
    throw new Error(`Unexpected package payload root: ${relativePath}`);
  }
  return normalized;
}

function copyPayloadPath(sourcePath, destinationPath) {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to copy symlink from package payload: ${sourcePath}`);
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyPayloadPath(path.join(sourcePath, entry), path.join(destinationPath, entry));
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Refusing to copy non-file package payload entry: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  fs.chmodSync(destinationPath, stat.mode);
}

function readInstallState(homeDir = os.homedir()) {
  const paths = resolvePaths(homeDir);
  if (!fs.existsSync(paths.installStatePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(paths.installStatePath, "utf8"));
}

function replaceSymlink(targetPath, destinationPath) {
  const tempPath = `${destinationPath}.tmp-${process.pid}`;
  fs.rmSync(tempPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.symlinkSync(targetPath, tempPath);
  fs.rmSync(destinationPath, { recursive: true, force: true });
  fs.renameSync(tempPath, destinationPath);
}

function copyRuntimePayload(sourceRoot, destinationRoot) {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const payloadPaths = [...new Set(["package.json", ...(sourcePackage.files ?? [])])];

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  for (const relativePath of payloadPaths) {
    const safePath = normalizePayloadPath(relativePath);
    const sourcePath = path.join(sourceRoot, safePath);
    assertPathInside(sourceRoot, sourcePath, "package source path");
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const destinationPath = path.join(destinationRoot, safePath);
    assertPathInside(destinationRoot, destinationPath, "package destination path");
    copyPayloadPath(sourcePath, destinationPath);
  }
}

function assertReleasePayload(releaseDir, version) {
  const releasePackage = JSON.parse(fs.readFileSync(path.join(releaseDir, "package.json"), "utf8"));
  if (releasePackage.name !== packageName || releasePackage.version !== version) {
    throw new Error(`Packaged runtime identity mismatch: expected ${packageName}@${version}`);
  }
  for (const requiredFile of [
    "bin/xgc.mjs",
    "runtime-dist/materialize-global-xgc.mjs",
    "runtime-dist/validate-global-xgc.mjs",
    "runtime-dist/xgc-update.mjs",
    "runtime-dist/xgc-uninstall.mjs",
    "scripts/install-global-xgc.sh",
    "scripts/uninstall-global-xgc.sh"
  ]) {
    if (!fs.existsSync(path.join(releaseDir, requiredFile))) {
      throw new Error(`Packaged runtime is missing required file: ${requiredFile}`);
    }
  }
}

function prepareRuntimeRelease({ sourceRoot, version, homeDir }) {
  if (!parseSemver(version)) {
    throw new Error(`Invalid runtime release version: ${version}`);
  }
  const paths = resolvePaths(homeDir);
  const releaseDir = path.join(paths.runtimeReleasesHome, version);
  assertPathInside(paths.runtimeReleasesHome, releaseDir, "runtime release path");
  if (realpathSafe(sourceRoot) !== realpathSafe(releaseDir)) {
    copyRuntimePayload(sourceRoot, releaseDir);
  }
  assertReleasePayload(releaseDir, version);
  return { paths, releaseDir };
}

function readCurrentRuntimeTarget(paths) {
  try {
    const stat = fs.lstatSync(paths.runtimeCurrentPath);
    if (stat.isSymbolicLink()) {
      return fs.readlinkSync(paths.runtimeCurrentPath);
    }
  } catch {
    return null;
  }
  return null;
}

function activateRuntimeRelease(paths, releaseDir) {
  assertPathInside(paths.runtimeReleasesHome, releaseDir, "runtime release path");
  replaceSymlink(releaseDir, paths.runtimeCurrentPath);
}

function rollbackRuntimeCurrent(paths, previousTarget) {
  if (!previousTarget) {
    fs.rmSync(paths.runtimeCurrentPath, { force: true, recursive: true });
    return;
  }
  replaceSymlink(previousTarget, paths.runtimeCurrentPath);
}

function parseInstallArgs(argv) {
  const parsed = {
    homeDir: os.homedir(),
    writeShellProfile: true,
    passthroughArgs: [],
    permissionMode: null,
    releaseRepo: null,
    releaseTag: null,
    updateTrack: null,
    updateChannel: null,
    autoUpdateMode: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--home-dir" && argv[index + 1]) {
      parsed.homeDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (current === "--permission-mode" && argv[index + 1]) {
      parsed.permissionMode = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--release-repo" && argv[index + 1]) {
      parsed.releaseRepo = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--release-tag" && argv[index + 1]) {
      parsed.releaseTag = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--update-track" && argv[index + 1]) {
      parsed.updateTrack = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--update-channel" && argv[index + 1]) {
      parsed.updateChannel = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--auto-update-mode" && argv[index + 1]) {
      parsed.autoUpdateMode = argv[index + 1];
      parsed.passthroughArgs.push(current, argv[index + 1]);
      index += 1;
    } else if (current === "--no-write-shell-profile") {
      parsed.writeShellProfile = false;
    } else {
      parsed.passthroughArgs.push(current);
    }
  }

  if (parsed.writeShellProfile && !parsed.passthroughArgs.includes("--write-shell-profile")) {
    parsed.passthroughArgs.unshift("--write-shell-profile");
  }
  if (!parsed.releaseTag && !parsed.passthroughArgs.includes("--release-tag")) {
    parsed.releaseTag = packageVersion;
    parsed.passthroughArgs.push("--release-tag", packageVersion);
  }

  return parsed;
}

function maybeDispatchToInstalledRuntime(command, argv) {
  if (process.env.XGC_SKIP_SELF_DISPATCH === "1") {
    return false;
  }
  if (command === "install" || command === "help" || command === "--help" || command === "-h" || command === "status") {
    return false;
  }

  const homeDir = os.homedir();
  const paths = resolvePaths(homeDir);
  if (!fs.existsSync(paths.runtimeCurrentBinPath)) {
    return false;
  }

  const currentRoot = realpathSafe(packageRoot);
  const installedRoot = realpathSafe(path.resolve(paths.runtimeCurrentPath));
  if (installedRoot === currentRoot) {
    return false;
  }

  run(process.execPath, [paths.runtimeCurrentBinPath, command, ...argv], {
    cwd: installedRoot,
    env: {
      ...process.env,
      XGC_SKIP_SELF_DISPATCH: "1"
    }
  });
  return true;
}

function printHelp() {
  process.stdout.write(
    [
      "X for GitHub Copilot CLI",
      "",
      `Usage: ${packageName} <command> [options]`,
      "   or: xgc <command> [options]",
      "",
      "Commands:",
      "  install     Install/materialize XGC and seed the installed runtime store",
      "  doctor      Run global/profile validation against the installed runtime",
      "  update      Check or apply the latest compatible release into the runtime store",
      "  uninstall   Disable or remove the installed XGC profile",
      "  status      Print the current install-state summary",
      "",
      "Install examples:",
      `  npx ${packageName} install`,
      `  npx ${packageName} install --permission-mode work`,
      `  npx ${packageName} install --permission-mode work --reasoning-effort xhigh --reasoning-effort-cap high`,
      `  npx ${packageName} install --permission-mode work --reasoning-effort xhigh --reasoning-effort-cap xhigh`,
      `  bunx ${packageName} install`,
      "",
      "After install:",
      "  xgc",
      "  xgc doctor",
      "  xgc update --check",
      "  xgc update",
      "  xgc uninstall --disable-only",
      "  xgc status",
      "",
      "Defaults:",
      "  installed XGC sessions request --reasoning-effort xhigh but cap to high by default for account/subscription safety",
      "  set XGC_REASONING_EFFORT_CAP=xhigh, or install with --reasoning-effort-cap xhigh, only when the account supports xhigh",
      "  set XGC_REASONING_EFFORT=off to disable that injection for a shell",
      "",
      "Update examples:",
      `  npx ${packageName} update --check`,
      `  npx ${packageName} update`
    ].join("\n")
  );
}

function hasHelpFlag(argv) {
  return argv.includes("--help") || argv.includes("-h");
}

function printCommandHelp(command) {
  const usageByCommand = {
    install: [
      `Usage: ${packageName} install [options]`,
      "",
      "Install/materialize XGC and seed the installed runtime store.",
      "",
      "Options:",
      "  --home-dir <path>                 Use an alternate home directory",
      "  --permission-mode <ask|work|yolo> Persist the default Copilot permission mode",
      "  --reasoning-effort <level>        Request a Copilot reasoning effort for XGC sessions",
      "  --reasoning-effort-cap <level>    Cap injected reasoning effort for account safety",
      "  --release-tag <version>           Record the runtime release tag",
      "  --no-write-shell-profile          Do not modify shell startup files",
      "",
      "Examples:",
      `  npx ${packageName} install`,
      `  npx ${packageName} install --permission-mode work --reasoning-effort xhigh --reasoning-effort-cap high`
    ],
    doctor: [
      `Usage: ${packageName} doctor [options]`,
      "",
      "Run global/profile validation against the installed runtime.",
      "",
      "Options:",
      "  --home-dir <path>           Use an alternate home directory",
      "  --allow-legacy-plugins      Report, rather than fail, enabled legacy hook plugin conflicts"
    ],
    update: [
      `Usage: ${packageName} update [options]`,
      "",
      "Check or apply the latest compatible release into the runtime store.",
      "",
      "Options:",
      "  --check                     Check only; do not apply an update",
      "  --home-dir <path>           Use an alternate home directory",
      "  --repo <owner/repo>         Override the GitHub release repository"
    ],
    uninstall: [
      `Usage: ${packageName} uninstall [options]`,
      "",
      "Disable or remove the installed XGC profile.",
      "",
      "Options:",
      "  --home-dir <path>           Use an alternate home directory",
      "  --disable-only              Disable shell activation without removing runtime files",
      "  --purge                     Remove installed XGC runtime/profile files"
    ],
    status: [
      `Usage: ${packageName} status`,
      "",
      "Print the current install-state summary."
    ]
  };

  const lines = usageByCommand[command];
  if (!lines) {
    return false;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return true;
}

function printStatus() {
  const paths = resolvePaths(os.homedir());
  const installState = readInstallState();
  const payload = {
    installed: Boolean(installState),
    installStatePath: paths.installStatePath,
    runtimeHome: paths.runtimeHome,
    runtimeCurrentPath: paths.runtimeCurrentPath,
    runtimeCurrentBinPath: paths.runtimeCurrentBinPath,
    shellEnvPath: path.join(paths.configHome, "profile.env"),
    shellShimPath: path.join(paths.configHome, "xgc-shell.sh"),
    installState
  };

  process.stdout.write(formatJson(payload));
}

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const rest = args.slice(1);

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (hasHelpFlag(rest) && printCommandHelp(command)) {
  process.exit(0);
}

if (maybeDispatchToInstalledRuntime(command, rest)) {
  process.exit(0);
}

switch (command) {
  case "install": {
    const installArgs = parseInstallArgs(rest);
    const { paths, releaseDir } = prepareRuntimeRelease({
      sourceRoot: packageRoot,
      version: packageVersion,
      homeDir: installArgs.homeDir
    });
    const previousCurrentTarget = readCurrentRuntimeTarget(paths);
    activateRuntimeRelease(paths, releaseDir);
    const result = spawnSync("bash", [path.join(releaseDir, "scripts", "install-global-xgc.sh"), "--packaged-runtime", ...installArgs.passthroughArgs], {
      stdio: "inherit",
      cwd: releaseDir,
      env: {
        ...process.env,
        HOME: installArgs.homeDir
      }
    });
    if (result.status !== 0) {
      rollbackRuntimeCurrent(paths, previousCurrentTarget);
      process.exit(typeof result.status === "number" ? result.status : 1);
    }
    break;
  }
  case "doctor": {
    run(process.execPath, [requireRuntimeEntry("validate-global-xgc.mjs"), "--repo-root", packageRoot, ...rest], {
      cwd: packageRoot
    });
    break;
  }
  case "update": {
    run(process.execPath, [requireRuntimeEntry("xgc-update.mjs"), ...rest], {
      cwd: packageRoot
    });
    break;
  }
  case "uninstall": {
    run(process.execPath, [requireRuntimeEntry("xgc-uninstall.mjs"), ...rest], {
      cwd: packageRoot
    });
    break;
  }
  case "status": {
    printStatus();
    break;
  }
  case "help":
  case "--help":
  case "-h": {
    printHelp();
    break;
  }
  default: {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
  }
}
