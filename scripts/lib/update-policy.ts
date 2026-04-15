export type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
};

export type XgcUpdatePolicy = "patch-within-track" | "minor-within-major";
export type XgcUpdateChannel = "stable";
export type XgcAutoUpdateMode = "off" | "check" | "apply";

export function parseSemver(input: string): ParsedSemver | null {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function formatSemver(version: ParsedSemver) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareSemver(left: ParsedSemver, right: ParsedSemver) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function deriveDefaultUpdateTrack(version: string | ParsedSemver) {
  const parsed = typeof version === "string" ? parseSemver(version) : version;
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${String(version)}`);
  }
  return parsed.major === 0 ? `0.${parsed.minor}` : String(parsed.major);
}

export function deriveDefaultUpdatePolicy(version: string | ParsedSemver): XgcUpdatePolicy {
  const parsed = typeof version === "string" ? parseSemver(version) : version;
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${String(version)}`);
  }
  return parsed.major === 0 ? "patch-within-track" : "minor-within-major";
}

export function normalizeAutoUpdateMode(value: string | null | undefined): XgcAutoUpdateMode {
  if (value === "off" || value === "check" || value === "apply") {
    return value;
  }
  return "check";
}

export function isCompatibleUpdate(opts: {
  current: string | ParsedSemver;
  candidate: string | ParsedSemver;
  track?: string | null;
  policy?: XgcUpdatePolicy | null;
}) {
  const current = typeof opts.current === "string" ? parseSemver(opts.current) : opts.current;
  const candidate = typeof opts.candidate === "string" ? parseSemver(opts.candidate) : opts.candidate;
  if (!current || !candidate) {
    return false;
  }
  if (compareSemver(candidate, current) <= 0) {
    return false;
  }

  const policy = opts.policy ?? deriveDefaultUpdatePolicy(current);
  const track = opts.track ?? deriveDefaultUpdateTrack(current);

  if (policy === "patch-within-track") {
    const expectedTrack = `${candidate.major}.${candidate.minor}`;
    return track === expectedTrack;
  }

  const expectedTrack = String(candidate.major);
  return track === expectedTrack;
}

export function selectLatestCompatibleVersion<T extends { version: string }>(
  versions: T[],
  opts: {
    current: string;
    track?: string | null;
    policy?: XgcUpdatePolicy | null;
  }
) {
  const compatibles = versions
    .filter((entry) =>
      isCompatibleUpdate({
        current: opts.current,
        candidate: entry.version,
        track: opts.track,
        policy: opts.policy
      })
    )
    .sort((left, right) => {
      const leftVersion = parseSemver(left.version);
      const rightVersion = parseSemver(right.version);
      if (!leftVersion || !rightVersion) {
        return 0;
      }
      return compareSemver(rightVersion, leftVersion);
    });

  return compatibles[0] ?? null;
}
