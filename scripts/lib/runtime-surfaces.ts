import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ROOT_MODEL,
  expectedAgentModelPolicy,
  normalizeAgentModelPolicy,
  resolveAgentModelPolicy
} from "./model-policy.js";

export const builtInAgentIds = [
  "explore",
  "task",
  "code-review",
  "general-purpose",
  "research"
] as const;

export const renameMap = [
  ["sisyphus", "repo-master"],
  ["hephaestus", "patch-master"],
  ["explore", "repo-scout"],
  ["librarian", "ref-index"],
  ["oracle", "merge-gate"],
  ["prometheus", "milestone"],
  ["atlas", "maintainer"],
  ["metis", "triage"],
  ["momus", "required-check"]
] as const;

export type RenamePair = (typeof renameMap)[number];

export type SurfaceSyncResult = {
  source: string;
  target: string;
  changed: boolean;
};

export const runtimeAgentFrontmatterAllowlist = new Set([
  "name",
  "description",
  "tools",
  "model",
  "user-invocable",
  "disable-model-invocation"
]);

export const runtimeAgentUnsupportedFrontmatterKeys = new Set(["target", "metadata", "modelPolicy"]);

export function resolveRepoRoot(currentFile: string) {
  let cursor = path.dirname(currentFile);

  while (true) {
    if (syncFs.existsSync(path.join(cursor, "package.json"))) {
      return cursor;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`Unable to resolve repository root from ${currentFile}`);
    }
    cursor = parent;
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }
      return [fullPath];
    })
  );

  return files.flat();
}

type FrontmatterSection = {
  key: string;
  lines: string[];
};

function splitFrontmatter(content: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return null;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    return null;
  }

  return {
    frontmatterLines: lines.slice(1, endIndex),
    body: lines.slice(endIndex + 1).join("\n")
  };
}

function parseFrontmatterSections(frontmatterLines: string[]): FrontmatterSection[] {
  const sections: FrontmatterSection[] = [];
  let current: FrontmatterSection | null = null;

  for (const line of frontmatterLines) {
    const keyMatch = /^([A-Za-z0-9_-]+):(?:\s|$)/.exec(line);
    if (keyMatch) {
      current = {
        key: keyMatch[1],
        lines: [line]
      };
      sections.push(current);
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  return sections;
}

export function listRuntimeFrontmatterKeys(content: string) {
  const parsed = splitFrontmatter(content);
  if (!parsed) return [];
  return parseFrontmatterSections(parsed.frontmatterLines).map((section) => section.key);
}

function readScalarSectionValue(section: FrontmatterSection) {
  const match = new RegExp(`^${section.key}:\\s*(.*)$`).exec(section.lines[0]);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "") || null;
}

function renderFrontmatterScalar(value: string) {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : JSON.stringify(value);
}

function replaceOrAppendModelSection(
  sections: FrontmatterSection[],
  model: string | null,
  options: { removeModel?: boolean } = {}
) {
  if (options.removeModel) {
    return sections.filter((section) => section.key !== "model");
  }
  if (!model) return sections;
  const renderedModel = renderFrontmatterScalar(model);

  let modelWritten = false;
  const rendered = sections.map((section) => {
    if (section.key !== "model") return section;
    modelWritten = true;
    return {
      key: "model",
      lines: [`model: ${renderedModel}`]
    };
  });

  if (!modelWritten) {
    rendered.push({ key: "model", lines: [`model: ${renderedModel}`] });
  }

  return rendered;
}

export function renderRuntimeAgentContent(
  content: string,
  options: { agentId?: string | null; rootModel?: string | null } = {}
) {
  const parsed = splitFrontmatter(content);
  if (!parsed) return content;

  const sections = parseFrontmatterSections(parsed.frontmatterLines);
  const modelPolicySection = sections.find((section) => section.key === "modelPolicy");
  const modelPolicy = normalizeAgentModelPolicy(modelPolicySection ? readScalarSectionValue(modelPolicySection) : null);
  const effectiveModelPolicy = modelPolicy ?? (options.agentId ? expectedAgentModelPolicy(options.agentId) : null);
  const inheritRootModel = effectiveModelPolicy === "root-selected";
  const resolvedModel = options.agentId
    ? resolveAgentModelPolicy({
        agentId: options.agentId,
        modelPolicy: modelPolicy,
        rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL
      })
    : null;
  const keptSections = replaceOrAppendModelSection(sections, inheritRootModel ? null : resolvedModel, {
    removeModel: inheritRootModel
  }).filter((section) => runtimeAgentFrontmatterAllowlist.has(section.key));

  const renderedFrontmatter = ["---", ...keptSections.flatMap((section) => section.lines), "---"];
  return `${renderedFrontmatter.join("\n")}\n${parsed.body}`;
}

function agentIdFromRelativePath(relativePath: string) {
  return relativePath.endsWith(".agent.md") ? path.basename(relativePath, ".agent.md") : null;
}

function transformRuntimeSurfaceContent(
  sourceDir: string,
  content: string,
  options: { relativePath?: string; rootModel?: string | null } = {}
) {
  if (sourceDir.endsWith(`${path.sep}source${path.sep}agents`) || sourceDir.endsWith("source/agents")) {
    return renderRuntimeAgentContent(content, {
      agentId: options.relativePath ? agentIdFromRelativePath(options.relativePath) : null,
      rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL
    });
  }
  return content;
}

async function readRelativeFileMap(root: string) {
  const files = await listFilesRecursive(root);
  const map = new Map<string, string>();

  for (const file of files) {
    const relativePath = path.relative(root, file);
    map.set(relativePath, await fs.readFile(file, "utf8"));
  }

  return map;
}

async function ensureCleanCopy(sourceDir: string, targetDir: string) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
}

async function writeTransformedCopy(
  sourceDir: string,
  targetDir: string,
  options: { rootModel?: string | null } = {}
) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });

  const files = await listFilesRecursive(sourceDir);
  for (const file of files) {
    const relativePath = path.relative(sourceDir, file);
    const content = await fs.readFile(file, "utf8");
    const transformed = transformRuntimeSurfaceContent(sourceDir, content, {
      relativePath,
      rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL
    });
    const targetPath = path.join(targetDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, transformed);
  }
}

async function checkMirrorParity(
  sourceDir: string,
  targetDir: string,
  options: { rootModel?: string | null } = {}
) {
  const [sourceFiles, targetFiles] = await Promise.all([
    readRelativeFileMap(sourceDir),
    readRelativeFileMap(targetDir)
  ]);

  const sourceKeys = [...sourceFiles.keys()].sort();
  const targetKeys = [...targetFiles.keys()].sort();

  if (sourceKeys.length !== targetKeys.length) {
    throw new Error(
      `Mirror drift between ${sourceDir} and ${targetDir}: file count differs (${sourceKeys.length} vs ${targetKeys.length})`
    );
  }

  for (let index = 0; index < sourceKeys.length; index += 1) {
    if (sourceKeys[index] !== targetKeys[index]) {
      throw new Error(
        `Mirror drift between ${sourceDir} and ${targetDir}: expected ${sourceKeys[index]} but found ${targetKeys[index]}`
      );
    }
  }

  for (const [relativePath, sourceContent] of sourceFiles.entries()) {
    const targetContent = targetFiles.get(relativePath);
    const expectedContent = transformRuntimeSurfaceContent(sourceDir, sourceContent, {
      relativePath,
      rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL
    });
    if (targetContent !== expectedContent) {
      throw new Error(
        `Mirror drift between ${sourceDir} and ${targetDir}: content mismatch for ${relativePath}`
      );
    }
  }
}

async function mirrorIsCurrent(
  sourceDir: string,
  targetDir: string,
  options: { rootModel?: string | null } = {}
) {
  try {
    await checkMirrorParity(sourceDir, targetDir, options);
    return true;
  } catch {
    return false;
  }
}

export async function syncRuntimeSurfaces(
  repoRoot: string,
  options: { check?: boolean; rootModel?: string | null } = {}
): Promise<SurfaceSyncResult[]> {
  const surfaces: Array<{ source: string; target: string; transform: boolean }> = [
    { source: "source/agents", target: "agents", transform: true },
    { source: "source/agents", target: ".github/agents", transform: true },
    { source: "source/skills", target: "skills", transform: false },
    { source: "source/skills", target: ".github/skills", transform: false }
  ];

  const results: SurfaceSyncResult[] = [];

  for (const surface of surfaces) {
    const sourceDir = path.join(repoRoot, surface.source);
    const targetDir = path.join(repoRoot, surface.target);

    if (options.check) {
      await checkMirrorParity(sourceDir, targetDir, { rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL });
      results.push({ source: surface.source, target: surface.target, changed: false });
      continue;
    }

    if (await mirrorIsCurrent(sourceDir, targetDir, { rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL })) {
      results.push({ source: surface.source, target: surface.target, changed: false });
      continue;
    }

    if (surface.transform) {
      await writeTransformedCopy(sourceDir, targetDir, { rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL });
    } else {
      await ensureCleanCopy(sourceDir, targetDir);
    }
    results.push({ source: surface.source, target: surface.target, changed: true });
  }

  return results;
}

export async function writeRuntimeAgentMirror(
  sourceDir: string,
  targetDir: string,
  options: { rootModel?: string | null } = {}
) {
  await writeTransformedCopy(sourceDir, targetDir, { rootModel: options.rootModel ?? DEFAULT_ROOT_MODEL });
}

export async function listCanonicalAgentIds(repoRoot: string) {
  const agentsDir = path.join(repoRoot, "source", "agents");
  const entries = await fs.readdir(agentsDir);
  return entries
    .filter((entry) => entry.endsWith(".agent.md"))
    .map((entry) => entry.replace(/\.agent\.md$/, ""))
    .sort();
}

export function listCanonicalAgentIdsSync(repoRoot: string) {
  const agentsDir = path.join(repoRoot, "source", "agents");
  return syncFs
    .readdirSync(agentsDir)
    .filter((entry) => entry.endsWith(".agent.md"))
    .map((entry) => entry.replace(/\.agent\.md$/, ""))
    .sort();
}

export function listCanonicalSkillIdsSync(repoRoot: string) {
  const skillsDir = path.join(repoRoot, "source", "skills");
  return syncFs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
