import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, "..");

export function readText(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

export function readJson<T>(relativePath: string) {
  return JSON.parse(readText(relativePath)) as T;
}

export function exists(relativePath: string) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

export function listDir(relativePath: string) {
  return fs.readdirSync(path.join(repoRoot, relativePath));
}

export function listFilesRecursive(relativePath: string) {
  const root = path.join(repoRoot, relativePath);
  const files: string[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(path.relative(root, fullPath));
      }
    }
  };

  walk(root);
  return files.sort();
}
