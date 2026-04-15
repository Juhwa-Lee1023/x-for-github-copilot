import { createHash } from "node:crypto";
import { agentAllowsGitHubContextByDefault } from "./runtime-routing-policy.js";

export type GitHubProbeObservation =
  | "skipped_for_route"
  | "allowed_for_review_context"
  | "disabled_after_404"
  | "attempted"
  | "unproven";

export type GitHubCapabilityCheck =
  | "skipped"
  | "allowed_but_unobserved"
  | "checked_fresh"
  | "reused_from_cache"
  | "disabled_after_404";

export type GitHubCapabilityCheckSource =
  | "route_skip"
  | "policy_only"
  | "process_log"
  | "session_cache"
  | "failure_cache";

export type GitHubCapabilityCheckSummary = {
  check: GitHubCapabilityCheck;
  cached: boolean;
  source: GitHubCapabilityCheckSource;
  cacheHit: boolean;
  cacheMiss: boolean;
};

export type GitHubProbeLogObservation = {
  memoryEnabledSuccessCount: number;
  memoryEnabled404Count: number;
  memoryPrompt404Count: number;
  prSuccessCount: number;
  pr404Count: number;
};

export type GitHubProbeCache = {
  repoIdentity: string;
  sessionIdentity: string;
  scopeKey: string;
  memoryEnabledAvailable: boolean;
  memoryEnabledUnavailable: boolean;
  memoryPromptUnavailable: boolean;
  prAvailable: boolean;
  prUnavailable: boolean;
  memoryEnabledSuccessCount: number;
  memoryEnabled404Count: number;
  memoryPrompt404Count: number;
  prSuccessCount: number;
  pr404Count: number;
};

export type GitHubProbePolicy = {
  disableBuiltinMcps: boolean;
  disableSpecificMcpServers: string[];
  disableExperimentalFeatures: boolean;
  githubMemoryEnabledProbe: GitHubProbeObservation;
  githubMemoryPromptProbe: GitHubProbeObservation;
  prLookup: GitHubProbeObservation;
  notes: string[];
};

export function agentAllowsGitHubContext(agentId: string | null | undefined) {
  return agentAllowsGitHubContextByDefault(agentId);
}

export function buildGitHubProbeScopeKey(opts: {
  repoIdentity?: string | null;
  sessionIdentity?: string | null;
}) {
  return `${opts.sessionIdentity ?? "unknown-session"}::${opts.repoIdentity ?? "unknown-repo"}`;
}

export function githubProbeRepoIdentitySupportsLiveContext(repoIdentity: string | null | undefined) {
  const normalized = repoIdentity?.trim() ?? "";
  if (!normalized || normalized === "unknown-repo") return false;
  if (/^local-repo-[0-9a-f]{12}$/i.test(normalized)) return false;
  return true;
}

export function resolveGitHubProbeRepoIdentity(opts: {
  remoteUrl?: string | null;
  repoPath?: string | null;
}) {
  const remoteUrl = opts.remoteUrl?.trim() ?? "";
  for (const pattern of [
    /^git@github\.com:(.+?)(?:\.git)?\/?$/,
    /^(?:ssh|git\+ssh):\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/,
    /^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/
  ]) {
    const match = remoteUrl.match(pattern);
    if (match) {
      return match[1].replace(/\.git$/i, "").replace(/\/$/, "");
    }
  }

  const repoPath = opts.repoPath?.trim();
  if (!repoPath) {
    return "unknown-repo";
  }

  const digest = createHash("sha1").update(repoPath).digest("hex").slice(0, 12);
  return `local-repo-${digest}`;
}

function normalizeGitHubProbeScope(
  previous: GitHubProbeCache,
  scope: { repoIdentity?: string | null; sessionIdentity?: string | null }
) {
  const repoIdentity = scope.repoIdentity ?? previous.repoIdentity;
  const sessionIdentity = scope.sessionIdentity ?? previous.sessionIdentity;
  const scopeKey = buildGitHubProbeScopeKey({ repoIdentity, sessionIdentity });
  if (previous.scopeKey !== scopeKey) {
    return emptyGitHubProbeCache({ repoIdentity, sessionIdentity });
  }
  return {
    ...previous,
    repoIdentity,
    sessionIdentity,
    scopeKey
  };
}

export function emptyGitHubProbeCache(opts: {
  repoIdentity?: string | null;
  sessionIdentity?: string | null;
} = {}): GitHubProbeCache {
  const repoIdentity = opts.repoIdentity ?? "unknown-repo";
  const sessionIdentity = opts.sessionIdentity ?? "unknown-session";
  return {
    repoIdentity,
    sessionIdentity,
    scopeKey: buildGitHubProbeScopeKey({ repoIdentity, sessionIdentity }),
    memoryEnabledAvailable: false,
    memoryEnabledUnavailable: false,
    memoryPromptUnavailable: false,
    prAvailable: false,
    prUnavailable: false,
    memoryEnabledSuccessCount: 0,
    memoryEnabled404Count: 0,
    memoryPrompt404Count: 0,
    prSuccessCount: 0,
    pr404Count: 0
  };
}

export function scanGitHubProbeLog(logText: string): GitHubProbeLogObservation {
  const counts: GitHubProbeLogObservation = {
    memoryEnabledSuccessCount: 0,
    memoryEnabled404Count: 0,
    memoryPrompt404Count: 0,
    prSuccessCount: 0,
    pr404Count: 0
  };

  let previousEpisodeKind: keyof GitHubProbeLogObservation | null = null;
  for (const line of logText.split(/\r?\n/)) {
    let episodeKind: keyof GitHubProbeLogObservation | null = null;
    if (/\bMemory enablement check:\s*enabled\b/i.test(line)) {
      episodeKind = "memoryEnabledSuccessCount";
    } else if (/\/internal\/memory\/[^ \n]+\/enabled\b[^ \n]*.*\b404\b/i.test(line)) {
      episodeKind = "memoryEnabled404Count";
    } else if (/\/internal\/memory\/[^ \n]+\/prompt\b[^ \n]*.*\b404\b/i.test(line)) {
      episodeKind = "memoryPrompt404Count";
    } else if (/\/pulls\?head=.*\s-\s2\d\d\b/i.test(line)) {
      episodeKind = "prSuccessCount";
    } else if (/\/pulls\?head=.*\b404\b/i.test(line)) {
      episodeKind = "pr404Count";
    }

    if (!episodeKind) {
      previousEpisodeKind = null;
      continue;
    }
    if (episodeKind !== previousEpisodeKind) {
      counts[episodeKind] += 1;
    }
    previousEpisodeKind = episodeKind;
  }

  return counts;
}

export function observeGitHubProbeResults(
  logText: string,
  previous: GitHubProbeCache = emptyGitHubProbeCache(),
  scope: { repoIdentity?: string | null; sessionIdentity?: string | null } = {}
) {
  const next = normalizeGitHubProbeScope(previous, scope);
  const observed = scanGitHubProbeLog(logText);

  if (observed.memoryEnabledSuccessCount > 0) {
    next.memoryEnabledAvailable = true;
    next.memoryEnabledSuccessCount += observed.memoryEnabledSuccessCount;
  }
  if (observed.memoryEnabled404Count > 0) {
    next.memoryEnabledUnavailable = true;
    next.memoryEnabled404Count += observed.memoryEnabled404Count;
  }
  if (observed.memoryPrompt404Count > 0) {
    next.memoryPromptUnavailable = true;
    next.memoryPrompt404Count += observed.memoryPrompt404Count;
  }
  if (observed.prSuccessCount > 0) {
    next.prAvailable = true;
    next.prSuccessCount += observed.prSuccessCount;
  }
  if (observed.pr404Count > 0) {
    next.prUnavailable = true;
    next.pr404Count += observed.pr404Count;
  }

  return next;
}

export function observeGitHubProbeFailures(
  logText: string,
  previous: GitHubProbeCache = emptyGitHubProbeCache(),
  scope: { repoIdentity?: string | null; sessionIdentity?: string | null } = {}
) {
  return observeGitHubProbeResults(logText, previous, scope);
}

export function summarizeGitHubCapabilityCheck(opts: {
  allowedForRoute: boolean;
  cachedAvailable: boolean;
  cachedUnavailable: boolean;
  observedSuccessCount: number;
  observedFailureCount: number;
}): GitHubCapabilityCheckSummary {
  const observedFresh = opts.observedSuccessCount > 0 || opts.observedFailureCount > 0;

  if (observedFresh) {
    return {
      check: "checked_fresh",
      cached: false,
      source: "process_log",
      cacheHit: false,
      cacheMiss: true
    };
  }

  if (!opts.allowedForRoute) {
    return {
      check: "skipped",
      cached: false,
      source: "route_skip",
      cacheHit: false,
      cacheMiss: false
    };
  }

  if (opts.cachedUnavailable) {
    return {
      check: "disabled_after_404",
      cached: true,
      source: "failure_cache",
      cacheHit: true,
      cacheMiss: false
    };
  }

  if (opts.cachedAvailable) {
    return {
      check: "reused_from_cache",
      cached: true,
      source: "session_cache",
      cacheHit: true,
      cacheMiss: false
    };
  }

  return {
    check: "allowed_but_unobserved",
    cached: false,
    source: "policy_only",
    cacheHit: false,
    cacheMiss: true
  };
}

export function resolveGitHubProbePolicy(opts: {
  agentId: string | null;
  caseId?: string | null;
  sessionCache?: GitHubProbeCache;
}) {
  const cache = opts.sessionCache ?? emptyGitHubProbeCache();
  const githubAllowed = agentAllowsGitHubContext(opts.agentId);
  const cachedMemorySuccess = cache.memoryEnabledAvailable;
  const cachedMemoryFailure = cache.memoryEnabledUnavailable || cache.memoryPromptUnavailable;
  const cachedPrFailure = cache.prUnavailable;
  const memoryEnabledProbe = cache.memoryEnabledUnavailable ? "disabled_after_404" : "skipped_for_route";
  const memoryPromptProbe = cache.memoryPromptUnavailable ? "disabled_after_404" : "skipped_for_route";
  const prLookup = cache.prUnavailable ? "disabled_after_404" : "skipped_for_route";
  const hasLiveGitHubIdentity = githubProbeRepoIdentitySupportsLiveContext(cache.repoIdentity);

  if (!hasLiveGitHubIdentity) {
    return {
      disableBuiltinMcps: true,
      disableSpecificMcpServers: ["github-mcp-server"],
      disableExperimentalFeatures: true,
      githubMemoryEnabledProbe: memoryEnabledProbe,
      githubMemoryPromptProbe: memoryPromptProbe,
      prLookup,
      notes: [
        "workspace has no live GitHub repository identity, so GitHub memory and PR probes are skipped early",
        "local-only workspaces use repo-local context instead of GitHub MCP probing",
        `GitHub probe cache scope: ${cache.scopeKey}`,
        ...(cache.memoryEnabledUnavailable || cache.memoryPromptUnavailable || cache.prUnavailable
          ? ["session-local cache already observed GitHub probe failures for this repo/session"]
          : [])
      ]
    } satisfies GitHubProbePolicy;
  }

  if (!githubAllowed) {
    return {
      disableBuiltinMcps: true,
      disableSpecificMcpServers: ["github-mcp-server"],
      disableExperimentalFeatures: true,
      githubMemoryEnabledProbe: memoryEnabledProbe,
      githubMemoryPromptProbe: memoryPromptProbe,
      prLookup,
      notes: [
        "selected lane does not expose GitHub-specific context by default",
        "early suppression requests both builtin-MCP disable and explicit github-mcp-server disable",
        `GitHub probe cache scope: ${cache.scopeKey}`,
        ...(cache.memoryEnabledUnavailable || cache.memoryPromptUnavailable || cache.prUnavailable
          ? ["session-local cache already observed GitHub probe 404s for this repo/session"]
          : [])
      ]
    } satisfies GitHubProbePolicy;
  }

  if (cachedMemoryFailure || cachedPrFailure) {
    return {
      disableBuiltinMcps: cachedPrFailure,
      disableSpecificMcpServers: cachedPrFailure ? ["github-mcp-server"] : [],
      disableExperimentalFeatures: true,
      githubMemoryEnabledProbe: cache.memoryEnabledUnavailable ? "disabled_after_404" : "allowed_for_review_context",
      githubMemoryPromptProbe: cache.memoryPromptUnavailable ? "disabled_after_404" : "allowed_for_review_context",
      prLookup: cache.prUnavailable ? "disabled_after_404" : "allowed_for_review_context",
      notes: [
        "cached GitHub probe failures are suppressing GitHub context earlier on this repo/session",
        "use an explicit GitHub MCP override only when the review task truly needs live GitHub context again",
        `GitHub probe cache scope: ${cache.scopeKey}`
      ]
    } satisfies GitHubProbePolicy;
  }

  if (cachedMemorySuccess) {
    return {
      disableBuiltinMcps: false,
      disableSpecificMcpServers: [],
      disableExperimentalFeatures: true,
      githubMemoryEnabledProbe: "allowed_for_review_context",
      githubMemoryPromptProbe: cache.memoryPromptUnavailable ? "disabled_after_404" : "allowed_for_review_context",
      prLookup: cache.prUnavailable ? "disabled_after_404" : "allowed_for_review_context",
      notes: [
        "cached GitHub memory enablement is being reused for this repo/session",
        "later review-oriented runs keep GitHub MCP context but suppress repeated experimental memory checks when safe",
        `GitHub probe cache scope: ${cache.scopeKey}`
      ]
    } satisfies GitHubProbePolicy;
  }

  return {
    disableBuiltinMcps: false,
    disableSpecificMcpServers: [],
    disableExperimentalFeatures: false,
    githubMemoryEnabledProbe: cache.memoryEnabledUnavailable ? "disabled_after_404" : "allowed_for_review_context",
    githubMemoryPromptProbe: cache.memoryPromptUnavailable ? "disabled_after_404" : "allowed_for_review_context",
    prLookup: cache.prUnavailable ? "disabled_after_404" : "allowed_for_review_context",
    notes: cache.memoryEnabledUnavailable || cache.memoryPromptUnavailable || cache.prUnavailable
      ? [
          "session-local cache already observed GitHub probe failures for this workspace",
          `GitHub probe cache scope: ${cache.scopeKey}`
        ]
      : [
          "route class may use GitHub context when the task explicitly needs it",
          `GitHub probe cache scope: ${cache.scopeKey}`
        ]
  } satisfies GitHubProbePolicy;
}
