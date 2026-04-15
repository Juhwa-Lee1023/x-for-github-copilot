#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

WRITE_LIKE_TOOLS = {"apply_patch", "write", "edit", "multi_edit", "create", "create_file", "write_file", "replace"}
BUILT_IN_GENERIC_AGENTS = {"Explore Agent", "General Purpose Agent", "explore", "general-purpose"}
POST_EXECUTION_PLANNER_REOPEN_AGENTS = {"Repo Scout", "Ref Index", "Milestone", "Triage"}
TERMINAL_FINALIZATION_EVENTS = {"agentStop", "subagentStop"}
TERMINAL_STOP_REASONS = {"end_turn"}
SESSION_SHUTDOWN_RECOVERY_EVENT = "sessionShutdownRecovery"
INTEGRATION_OWNED_SURFACE_PATTERNS = [
    re.compile(r"(^|/)(prisma/schema\.prisma|schema\.(prisma|sql))$", re.IGNORECASE),
    re.compile(r"(^|/)(migrations|db|database)/", re.IGNORECASE),
    re.compile(r"(^|/)(prisma/seed\.[^/]+|seed\.[^/]+|setup\.[^/]+|init\.[^/]+)$", re.IGNORECASE),
    re.compile(r"(^|/)(auth|session|middleware)(\.|/)", re.IGNORECASE),
    re.compile(r"(^|/)(\.env[^/]*|next\.config\.[^/]+|vite\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|tailwind\.config\.[^/]+|postcss\.config\.[^/]+|components\.json)$", re.IGNORECASE),
    re.compile(r"(^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig[^/]*\.json)$", re.IGNORECASE),
    re.compile(r"(^|/)(app/(layout|page|globals)\.[^/]+|src/app/(layout|page|globals)\.[^/]+|components/(shell|app-shell|navigation|nav|sidebar)(/|\.))", re.IGNORECASE),
    re.compile(r"(^|/)(src/)?components/(shell|app-shell|navigation|nav|sidebar)(/|\.)", re.IGNORECASE),
    re.compile(r"(^|/)(src/)?components/ui/(badge|status-badge|data-table)\.[^/]+$", re.IGNORECASE),
    re.compile(r"(^|/)(src/)?lib/(data|queries|seed|mocks|fixtures|test-utils|navigation|nav|routes|status|badges?|domain|domains|demo|demo-data)(/|\.)", re.IGNORECASE),
    re.compile(r"(^|/)(src/)?tests?/(helpers|fixtures|mocks|setup|e2e|smoke)(/|\.)", re.IGNORECASE),
    re.compile(r"(^|/)(e2e|playwright|cypress)/(fixtures|setup|helpers|smoke|specs?)(/|\.)", re.IGNORECASE),
    re.compile(r"(^|/)(README\.md|docs/[^/]+\.md)$", re.IGNORECASE),
    re.compile(r"(^|/)(hooks/hooks\.json|\.github/hooks/xgc-hooks\.json|lsp\.json|\.github/mcp\.json)$", re.IGNORECASE),
    re.compile(r"(^|/)(source/agents|agents|\.github/agents|source/skills|skills|\.github/skills)/", re.IGNORECASE),
    re.compile(r"(^|/)scripts/(lib/runtime-|hooks/finalize-session-summary\.py|smoke-copilot-cli\.ts|validate-global-xgc\.ts|xgc-shell\.sh|install-global-xgc\.sh)", re.IGNORECASE),
]
FIELD_ORDER = [
    "id",
    "cwd",
    "git_root",
    "repository",
    "host_type",
    "branch",
    "summary",
    "summary_count",
    "created_at",
    "updated_at",
    "latest_event_at",
    "final_status",
    "stop_reason",
    "route_summary",
    "route_summary_source",
    "route_summary_available",
    "route_summary_derived_from_raw_events",
    "route_summary_heuristic",
    "direct_tool_execution_observed",
    "direct_tool_events_observed",
    "tool_execution_count",
    "write_tool_count",
    "bash_tool_count",
    "session_shutdown_observed",
    "session_shutdown_type",
    "routine_shutdown_during_open_turn_observed",
    "session_shutdown_recovery_finalized",
    "terminal_stop_hook_observed",
    "session_shutdown_code_changes_observed",
    "session_shutdown_files_modified",
    "session_shutdown_lines_added",
    "session_shutdown_lines_removed",
    "summary_route_heuristic_mismatch",
    "summary_route_count_mismatch",
    "summary_capability_count_mismatch",
    "summary_timestamp_stale",
    "summary_finalization_status",
    "finalization_complete",
    "finalization_partial",
    "finalization_error",
    "summary_authority",
    "summary_authority_reasons",
    "archive_completeness",
    "archive_completeness_reasons",
    "route_agents",
    "key_agents",
    "repo_scout_invocation_count",
    "triage_invocation_count",
    "patch_master_invocation_count",
    "required_check_invocation_count",
    "built_in_generic_agent_invocation_count",
    "triage_duplicate_observed",
    "triage_duplicate_allowed_reason",
    "execution_ready_handoff_seen_before_second_triage",
    "patch_master_completed",
    "patch_master_completed_at",
    "post_execution_planner_reopen_agents",
    "post_execution_generic_agent_observed",
    "post_execution_built_in_agent_observed",
    "post_execution_generic_agents",
    "post_execution_built_in_agents",
    "post_execution_ownership_leak_observed",
    "ownership_leak_allowed_reason",
    "execution_owner",
    "ownership_transferred_to_execution",
    "background_execution_agent_observed",
    "background_execution_agent_unresolved",
    "background_agent_unresolved_observed",
    "background_agent_unresolved_ids",
    "background_execution_agent_ids",
    "background_agents_started",
    "background_agents_completed",
    "background_agents_read",
    "generic_result_reader_observed",
    "planner_result_read_proxy_observed",
    "planner_result_read_output_too_large_observed",
    "blocking_background_agents_unresolved",
    "execution_owner_agent_id",
    "execution_owner_result_read",
    "execution_owner_blocked_observed",
    "finalized_before_execution_owner_read",
    "post_execution_completion_gap_observed",
    "patch_master_handoff_without_completion_observed",
    "execution_handoff_without_observed_repo_diff",
    "malformed_task_payload_observed",
    "interactive_command_hang_observed",
    "interactive_command_hang_commands",
    "missing_builtin_agent_observed",
    "missing_builtin_agent_names",
    "post_execution_root_write_observed",
    "post_execution_root_patch_observed",
    "post_execution_root_write_count",
    "execution_owner_active_root_write_observed",
    "execution_owner_active_root_write_count",
    "execution_owner_active_root_patch_observed",
    "integration_class_task_observed",
    "foundation_readiness_assessed",
    "foundation_readiness_unknown",
    "foundation_risk_raised",
    "large_product_build_task_observed",
    "specialist_lane_expected",
    "required_specialist_lanes",
    "recommended_specialist_lanes",
    "observed_specialist_lanes",
    "missing_required_specialist_lanes",
    "unobserved_recommended_specialist_lanes",
    "specialist_fanout_observed",
    "specialist_fanout_partial",
    "specialist_fanout_covered_by_patch_master",
    "specialist_fanout_status",
    "specialist_fanout_reason",
    "patch_master_swarm_observed",
    "patch_master_swarm_count",
    "repeated_foundation_failure_observed",
    "foundation_recovery_suggested",
    "foundation_failure_classes",
    "foundation_recovery_reason",
    "bootstrap_failure_observed",
    "runtime_config_mismatch_observed",
    "tooling_materialization_failure_observed",
    "legacy_hook_plugin_conflict_observed",
    "hook_execution_failure_observed",
    "app_foundation_failure_observed",
    "validation_port_conflict_observed",
    "validation_server_readiness_failure_observed",
    "session_outcome",
    "session_outcome_detail",
    "useful_artifacts_observed",
    "validation_observed",
    "validation_status",
    "validation_raw_status",
    "validation_overclaim_observed",
    "validation_command_failures",
    "validation_recovered_after_failures_observed",
    "validation_recovery_source",
    "validation_recovered_command_failures",
    "session_start_head",
    "session_start_head_source",
    "session_start_git_status_files",
    "session_end_head",
    "session_head_changed",
    "working_tree_clean",
    "repo_changes_committed",
    "repo_changes_uncommitted",
    "working_tree_only_diff_observed",
    "committed_diff_source",
    "committed_diff_heuristic_observed",
    "repo_code_changed",
    "committed_repo_changed",
    "repo_working_tree_changed",
    "session_state_only",
    "execution_claim_without_observed_repo_diff",
    "committed_repo_files",
    "repo_working_tree_files",
    "preexisting_working_tree_files",
    "session_touched_repo_files",
    "session_state_files",
    "validation_artifact_files",
    "external_files",
    "integration_owned_surfaces_touched",
    "shared_surface_change_observed",
    "shared_surface_owner_declared",
    "shared_surface_conflict_risk",
    "shared_surface_review_recommended",
    "shared_surface_final_integrator_needed",
    "process_log",
    "github_repo_identity_missing_observed",
    "github_repo_identity_source",
    "github_memory_suppressed_for_missing_repo_identity",
    "github_memory_enabled_check",
    "github_memory_enabled_check_cached",
    "github_memory_enabled_check_count",
    "github_memory_enabled_success_count",
    "pr_context_check",
    "pr_context_check_cached",
    "pr_context_check_count",
    "github_pr_lookup_success_count",
    "github_capability_cache_hits",
    "github_capability_cache_misses",
    "github_memory_enabled_fresh_after_cache_observed",
    "pr_context_fresh_after_cache_observed",
    "probe_cache_summary",
    "provider_retry_observed",
    "provider_retry_state",
    "provider_retry_count",
    "provider_retry_reason",
    "user_abort_observed",
    "subagent_failure_observed",
    "terminal_provider_failure_observed",
    "requested_runtime_model",
    "session_current_model",
    "observed_runtime_models",
    "post_prompt_observed_runtime_models",
    "observed_agent_tool_models",
    "observed_model_metric_models",
    "mixed_model_session_observed",
    "non_requested_model_usage_observed",
    "model_identity_mismatch_observed",
    "agent_model_policy_mismatch_observed",
    "agent_model_policy_mismatch_authority_downgrade",
    "agent_model_policy_mismatch_count",
    "agent_model_policy_mismatches",
    "model_rate_limit_observed",
    "model_rate_limit_count",
    "provider_502_observed",
    "provider_502_count",
]


def collapse_consecutive(values):
    result = []
    for value in values:
        if not result or result[-1] != value:
            result.append(value)
    return result


def ordered_unique(values):
    seen = set()
    ordered = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def is_built_in_generic_agent(agent_name):
    normalized = str(agent_name or "").strip().lower()
    return (
        agent_name in BUILT_IN_GENERIC_AGENTS
        or normalized in {"explore", "explore agent", "general purpose agent", "general-purpose", "general-purpose agent"}
    )


def normalize_allowed_reason(value):
    reason = str(value or "").strip()
    if not reason:
        return None
    if re.search(
        r"^(none|no|n/a|na|null|false|not applicable|no blocker|no blockers|no named blocker|no explicit blocker)\b",
        reason,
        re.IGNORECASE,
    ):
        return None
    return reason


def extract_ownership_leak_allowed_reason(text):
    match = re.search(r"\bownership leak allowed reason\s*:\s*([^\n\r]+)", text, re.IGNORECASE)
    explicit_reason = normalize_allowed_reason(match.group(1) if match else None)
    if explicit_reason:
        return explicit_reason
    blocker_evidence_text = re.sub(
        r"\b(?:not|never|no longer)\s+blocked by\s+[^\n\r.;]+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    blocker_patterns = [
        r"\b(named|explicit)\s+blocker(?:\s*[:=-]\s*|\s+)(?!\s*(?:none|no|n/a|na|null|false|not applicable)\b)[^\n\r.;]+",
        r"\bblocker\s*:\s*(?!\s*(?:none|no|n/a|na|null|false|not applicable|no blocker|no blockers)\b)[^\n\r]+",
        r"\bblocked by\s+(?!\s*(?:none|no|n/a|na|null|false|not applicable)\b)[^\n\r.;]+",
        r"\bunresolved blocker(?:\s*[:=-]\s*|\s+)(?!\s*(?:none|no|n/a|na|null|false|not applicable)\b)[^\n\r.;]+",
    ]
    if any(re.search(pattern, blocker_evidence_text, re.IGNORECASE) for pattern in blocker_patterns):
        return "named_blocker"
    if re.search(r"\bnarrow (follow-?up|context|clarification)\b|\bbounded follow-?up\b|\btargeted (context|clarification|read|search)\b", text, re.IGNORECASE):
        return "narrow_follow_up"
    if re.search(r"\buser (requested|asked)\b.*\b(review|double check|recheck)\b|\brequired check requested\b", text, re.IGNORECASE):
        return "user_requested_review"
    return None


def extract_background_execution_agent_ids(text):
    return sorted(dict.fromkeys(match.group(1).rstrip(".。") for match in re.finditer(r"\bagent_id:\s*([A-Za-z0-9._:-]+)", text)))


def extract_completed_background_agent_ids(text):
    ids = []
    ids.extend(
        match.group(1).rstrip(".。")
        for match in re.finditer(r"\bBackground agent\s+[`\"]?([A-Za-z0-9._:-]+)[`\"]?\s+(?:has\s+)?completed\b", text, re.IGNORECASE)
    )
    ids.extend(
        match.group(1).rstrip(".。")
        for match in re.finditer(r"\bBackground agent\s+[`\"]?([A-Za-z0-9._:-]+)[`\"]?\s+finished\b", text, re.IGNORECASE)
    )
    ids.extend(
        match.group(1).rstrip(".。")
        for match in re.finditer(
            r"\bAgent\s+[\"'`]([A-Za-z0-9._:-]+)[\"'`]\s+\([^)]*\)\s+has\s+completed\b",
            text,
            re.IGNORECASE,
        )
    )
    return sorted(dict.fromkeys(agent_id for agent_id in ids if agent_id))


def extract_read_background_agent_ids(text):
    ids = []
    for line in text.splitlines():
        if re.search(r"\bUse\s+`?read_agent\b|\bto retrieve\b", line, re.IGNORECASE):
            continue
        ids.extend(
            match.group(1).rstrip(".。")
            for match in re.finditer(r"\bread_agent\(\s*[\"'`]([A-Za-z0-9._:-]+)[\"'`]\s*\)", line, re.IGNORECASE)
        )
        ids.extend(
            match.group(1).rstrip(".。")
            for match in re.finditer(
                r"\b(?:read|retrieved|consumed)\s+(?:the\s+)?(?:full\s+)?(?:results?|output|message)\s+(?:from|for)\s+(?:background\s+agent\s+)?[\"'`]?([A-Za-z0-9._:-]+)[\"'`]?",
                line,
                re.IGNORECASE,
            )
        )
    return sorted(dict.fromkeys(agent_id for agent_id in ids if agent_id))


def summarize_structured_background_agent_ids(events):
    completed = []
    read = []
    read_agent_starts = {}
    for entry in events:
        if not isinstance(entry, dict):
            continue
        event_type = entry.get("type")
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        if event_type == "system.notification":
            kind = data.get("kind") if isinstance(data.get("kind"), dict) else {}
            agent_id = kind.get("agentId")
            if kind.get("type") == "agent_completed" and isinstance(agent_id, str) and agent_id:
                completed.append(agent_id)
            continue
        if event_type == "tool.execution_start" and data.get("toolName") == "read_agent":
            args = normalize_tool_arguments(data.get("arguments"))
            agent_id = args.get("agent_id") or args.get("agentId")
            tool_call_id = data.get("toolCallId") or data.get("id")
            if isinstance(agent_id, str) and agent_id and isinstance(tool_call_id, str) and tool_call_id:
                read_agent_starts[tool_call_id] = agent_id
            continue
        if event_type == "tool.execution_complete" and data.get("toolName") == "read_agent":
            args = normalize_tool_arguments(data.get("arguments"))
            agent_id = args.get("agent_id") or args.get("agentId")
            tool_call_id = data.get("toolCallId") or data.get("id")
            if not isinstance(agent_id, str) and isinstance(tool_call_id, str):
                agent_id = read_agent_starts.get(tool_call_id)
            if isinstance(agent_id, str) and agent_id and is_successful_read_agent_completion(data):
                read.append(agent_id)
    return {
        "completed": sorted(dict.fromkeys(completed)),
        "read": sorted(dict.fromkeys(read)),
    }


def text_from_nested_value(value):
    parts = []

    def visit(nested):
        if isinstance(nested, str):
            parts.append(nested)
        elif isinstance(nested, dict):
            for child in nested.values():
                visit(child)
        elif isinstance(nested, list):
            for child in nested:
                visit(child)

    visit(value)
    return "\n".join(parts)


def is_successful_read_agent_completion(data):
    if not isinstance(data, dict):
        return False
    if data.get("error") or data.get("isError") is True:
        return False
    status = str(data.get("status") or data.get("outcome") or data.get("state") or "").strip().lower()
    if status in {"failed", "failure", "error", "errored", "cancelled", "canceled", "aborted", "timeout", "timed_out"}:
        return False
    exit_code = data.get("exitCode", data.get("exit_code"))
    if isinstance(exit_code, int) and exit_code != 0:
        return False
    result_text = text_from_nested_value(
        {
            "content": data.get("content"),
            "text": data.get("text"),
            "output": data.get("output"),
            "stdout": data.get("stdout"),
            "stderr": data.get("stderr"),
            "result": data.get("result"),
        }
    )
    if re.search(
        r"\b(output too large to read at once|request was aborted|read_agent(?:\s+tool)?\s+failed|failed to (?:read|retrieve|get)|cancelled|canceled|aborted)\b",
        result_text,
        re.IGNORECASE,
    ):
        return False
    return True


def is_execution_status_evidence_line(line):
    normalized = line.strip()
    if not normalized:
        return False
    if is_prompt_or_requirement_line(normalized) or is_planning_or_advisory_line(normalized):
        return False
    if re.search(r"\bExecution status:\s*ready_for_return\b", normalized, re.IGNORECASE) and re.search(
        r"\bExecution status:\s*blocked\b",
        normalized,
        re.IGNORECASE,
    ):
        return False
    return True


def has_execution_status_closure(text):
    return any(
        is_execution_status_evidence_line(line)
        and re.search(r"\bExecution status:\s*(ready_for_return|completed|complete|success)\b", line, re.IGNORECASE)
        for line in text.splitlines()
    )


def has_execution_status_ready_for_return(text):
    return any(
        is_execution_status_evidence_line(line)
        and re.search(r"\bExecution status:\s*ready_for_return\b", line, re.IGNORECASE)
        for line in text.splitlines()
    )


def has_execution_status_blocked(text):
    return any(
        is_execution_status_evidence_line(line)
        and re.search(r"\bExecution status:\s*blocked\b", line, re.IGNORECASE)
        for line in text.splitlines()
    )


def is_malformed_task_payload_line(line):
    normalized = line.strip()
    if not normalized:
        return False
    if is_prompt_or_requirement_line(normalized) or is_planning_or_advisory_line(normalized):
        return False
    return bool(
        re.search(
            r"\bExpected\s+['\"][,}]['\"]\s+or\s+['\"][,}]['\"]\s+after property value in JSON\b|\bUnexpected token\b.*\bJSON\b|\bJSON\.parse\b.*\b(error|failed|unexpected|malformed|SyntaxError)\b|\bmalformed (?:task|json|payload)\b",
            normalized,
            re.IGNORECASE,
        )
    )


def is_code_or_example_line(line):
    normalized = line.strip()
    if not normalized:
        return False
    return bool(
        re.search(
            r"^(?:>\s*)?(?:\d+\s*\|\s*)?(?:const|let|var|function|import|export|return|if|for|class|type|interface|enum|model)\b|^\s*(?:[{}[\],;]|\.\.\.|//)",
            normalized,
            re.IGNORECASE,
        )
    )


def is_foundation_noise_line(line):
    return bool(
        re.search(r"\bStarted MCP client for remote server\b|\bMCP client for .* connected\b", line, re.IGNORECASE)
        or re.search(r"\bMCP server .* provided deferred instructions\b", line, re.IGNORECASE)
        or (
            re.search(r"\bLSP .*server\b", line, re.IGNORECASE)
            and re.search(r"/node_modules/", line, re.IGNORECASE)
            and re.search(r"\b(warning|error while parsing|unexpected token)\b", line, re.IGNORECASE)
        )
    )


def is_planning_or_advisory_line(line):
    normalized = line.strip()
    if re.search(
            r"^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\d+[.)]\s*)?(?:\*\*)?(?:Acceptance|Acceptance criteria|Next steps?|Handoff|Plan|Implementation plan|Recommended|Recommendation|Notes?|Risks?|Validation requirements?|Confirmed|Verdict|Blocking gaps?|Hidden assumptions?|Missing constraints?|Weak acceptance criteria|What must be fixed before handoff)(?:\s*:\s*\*\*|\*\*\s*:|\s*:)",
        normalized,
        re.IGNORECASE,
    ):
        return True
    if re.search(
        r"^(?:\d{4}-\d{2}-\d{2}T|\[?ERROR\]?|Error:|Command failed|npm|npx|pnpm|yarn|bun|vitest|playwright|next\s+(?:build|dev|start|lint|info|telemetry)\b|prisma)\b",
        normalized,
        re.IGNORECASE,
    ):
        return False
    if re.search(r"^(?:[✗✖]\s*)?(?:Unable to load available models list|Authorization error|Access denied by policy settings)\b", normalized, re.IGNORECASE):
        return False
    return bool(
        re.search(
            r"\b(plan|Patch Master|should|would|could|will|assumption|risk|missing constraint|acceptance criteria)\b",
            normalized,
            re.IGNORECASE,
        )
    )


def is_runtime_tooling_issue_line(line):
    normalized = re.sub(r"\s+", " ", line.strip())
    if not normalized:
        return False
    if is_prompt_or_requirement_line(normalized) or is_planning_or_advisory_line(normalized):
        return False
    return bool(
        re.search(
            r"^(?:[$>#]\s*)?(?:view\s+/tmp/|(?:vi|vim|less|more|nano)\s+\S+|(?:npm|pnpm|yarn|bun)\s+create\s+vite\b)|^<exited with error:\s*posix_spawn failed\b|^Error:.*\bposix_spawn failed\b|\bposix_spawn failed\b",
            normalized,
            re.IGNORECASE,
        )
    )


def summarize_runtime_tooling_issues(text):
    commands = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line.strip())
        if not line:
            continue
        if is_runtime_tooling_issue_line(line):
            commands.append(line[:240])
    missing_builtin_agent_names = []
    missing_builtin_agent_names.extend(
        match.group(1)
        for match in re.finditer(r"\bFailed to load built-in agent\s+[\"'`]([^\"'`]+)[\"'`]", text, re.IGNORECASE)
    )
    missing_builtin_agent_names.extend(
        match.group(1)
        for match in re.finditer(r"definitions/([A-Za-z0-9._:-]+)\.agent\.ya?ml", text, re.IGNORECASE)
    )
    commands = sorted(dict.fromkeys(commands))
    missing_builtin_agent_names = sorted(dict.fromkeys(name for name in missing_builtin_agent_names if name))
    return {
        "interactive_command_hang_observed": len(commands) > 0,
        "interactive_command_hang_commands": commands,
        "missing_builtin_agent_observed": len(missing_builtin_agent_names) > 0,
        "missing_builtin_agent_names": missing_builtin_agent_names,
    }


def summarize_integration_class_signals(text, shared_surface_change_observed=False):
    integration_class_task_observed = bool(
        shared_surface_change_observed
        or re.search(
            r"\bintegration[-\s]class\b|\bintegration[-\s]scale\b|\bmulti[-\s]session\b|\bmulti[-\s]surface\b|\bcross[-\s]surface\b|\bshared[-\s]surface\b|foundation readiness\b|foundation freeze\b",
            text,
            re.IGNORECASE,
        )
    )
    foundation_readiness_assessed = bool(
        re.search(
            r"foundation readiness\s*:\s*(assessed|known|ready|checked|passed)\b|\bfoundation readiness assessed\b|\bfoundation gate\b|\bbaseline checks?\s*:\s*(known|passed|ready|checked)\b",
            text,
            re.IGNORECASE,
        )
    )
    foundation_risk_raised = bool(
        re.search(
            r"\bfoundation risk\b|foundation readiness\s*:\s*(unknown|blocked|risky|not ready)\b|\bfoundation not ready\b|\bbaseline unknown\b|\bunstable foundation\b",
            text,
            re.IGNORECASE,
        )
    )
    return {
        "integration_class_task_observed": integration_class_task_observed,
        "foundation_readiness_assessed": foundation_readiness_assessed,
        "foundation_risk_raised": foundation_risk_raised,
        "foundation_readiness_unknown": integration_class_task_observed and (not foundation_readiness_assessed or foundation_risk_raised),
    }


SPECIALIST_AGENT_NAMES = {
    "Visual Forge": "visual-forge",
    "visual-forge": "visual-forge",
    "xgc:visual-forge": "visual-forge",
    "Writing Desk": "writing-desk",
    "writing-desk": "writing-desk",
    "xgc:writing-desk": "writing-desk",
    "Multimodal Look": "multimodal-look",
    "multimodal-look": "multimodal-look",
    "xgc:multimodal-look": "multimodal-look",
    "Artistry Studio": "artistry-studio",
    "artistry-studio": "artistry-studio",
    "xgc:artistry-studio": "artistry-studio",
}


def multimodal_requirement_suppressed(text):
    text = text or ""
    if re.search(
        r"\bdo\s+not\s+(?:force|require|invoke|use)\s+(?:the\s+)?(?:multimodal|multimodal look|multimodal-look)\b"
        r"|\b(?:multimodal|multimodal look|multimodal-look)\b[\s\S]{0,80}\b(?:not required|not applicable|skip|skipped)\b",
        text,
        re.IGNORECASE,
    ):
        return True
    if re.search(
        r"\b(?:no|without)\s+(?:an?\s+|any\s+|actual\s+)?(?:visual artifact|media artifact|artifact input|attachment|attached file)s?\b",
        text,
        re.IGNORECASE,
    ):
        return True

    absence_phrases = re.finditer(
        r"\b(?:no|without|unless)\s+(?:an?\s+|any\s+|actual\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)(?:[\s/,;:|+&-]+(?:or\s+|and\s+)?(?:screenshot|image|pdf|diagram|mockup|wireframe|visual artifact))*s?\b",
        text,
        re.IGNORECASE,
    )
    for phrase in absence_phrases:
        artifacts = {
            match.group(1).lower()
            for match in re.finditer(
                r"\b(screenshot|image|pdf|diagram|mockup|wireframe|visual artifact)\b",
                phrase.group(0),
                re.IGNORECASE,
            )
        }
        if len(artifacts) >= 2:
            return True
    return False


def summarize_specialist_fanout(
    text,
    route_agents,
    invocation_counts,
    patch_master_started_count=0,
    scope_text=None,
    executed_route_agents=None,
):
    normalized = re.sub(r"\s+", " ", text or "").strip()
    scope_normalized = re.sub(r"\s+", " ", scope_text or "").strip()
    scope_lower = (scope_normalized or normalized).lower()
    lower = normalized.lower()
    single_session_scope_declared = bool(
        re.search(
            r"\b(one\s+single|single|one|only one|just one)[-\s]+(?:github[-\s]+)?copilot(?:[-\s]+cli)?(?:[-\s]+session)?\b"
            r"|\b(?:github[-\s]+)?copilot(?:[-\s]+cli)?[-\s]+session[-\s]+only\b"
            r"|\b(?:single|one)[-\s]+session[-\s]+(?:copilot|xgc|run|scope|execution|prompt|request|only)\b"
            r"|\b(?:keep|stay)\s+it\s+in\s+(?:a\s+)?(?:single|one)[-\s]+(?:(?:github\s+)?copilot(?:\s+cli)?(?:[-\s]+session)?|session)\b"
            r"|\bdo\s+not\s+fan[-\s]+out\b|\bno\s+(?:specialist\s+)?fan[-\s]*out\b"
            r"|단\s*하나의?\s*코파일럿|하나의\s*코파일럿|단일\s*코파일럿",
            scope_lower,
        )
    )
    specialist_observation_agents = executed_route_agents if executed_route_agents is not None else route_agents
    observed_specialist_lanes = ordered_unique(
        [SPECIALIST_AGENT_NAMES[name] for name in specialist_observation_agents if name in SPECIALIST_AGENT_NAMES]
    )
    module_hits = {
        match.group(0).lower()
        for match in re.finditer(
            r"\b(dashboard|projects?|workflows?|incidents?|runbooks?|services?|approvals?|audit|analytics|notifications?|settings|teams?|members?)\b",
            scope_lower,
        )
    }
    large_score = 0
    if re.search(r"\b(build|create|implement|develop|scaffold|ship)\b[\s\S]{0,64}\b(product|platform|application|app|saas|workspace)\b", scope_lower):
        large_score += 2
    if re.search(r"\b(complex|production[-\s]shaped|feature[-\s]rich|multi[-\s]tenant|large[-\s]scale|standalone|enterprise)\b", scope_lower):
        large_score += 1
    if re.search(r"\b(ui|ux|responsive|visual)\b[\s\S]{0,160}\b(docs?|documentation|readme)\b[\s\S]{0,160}\b(test|tests|testing)\b[\s\S]{0,160}\b(architecture|system design)\b", scope_lower):
        large_score += 2
    if len(module_hits) >= 4:
        large_score += 2
    elif len(module_hits) >= 2:
        large_score += 1
    large_product_build_task_observed = large_score >= 3
    explicit_visual = bool(
        re.search(r"\b(visual forge|visual-forge|visual-engineering)\b", scope_lower)
        or (
            re.search(
                r"\b(ui|ux|frontend|css|layout|responsive|visual|design|accessibility|animation|motion|theme|light mode|dark mode|browser extension|chrome extension)\b|라이트모드|다크모드|크롬\s*익스텐션|테마",
                scope_lower,
            )
            and not large_product_build_task_observed
        )
    )
    explicit_writing = bool(
        re.search(r"\b(writing desk|writing-desk)\b", scope_lower)
        or (re.search(r"\b(docs?|documentation|readme|guide|onboarding|release notes?|migration notes?|changelog|technical writing|prose)\b", scope_lower) and not large_product_build_task_observed)
    )
    explicit_multimodal = bool(
        not multimodal_requirement_suppressed(scope_lower)
        and (
            re.search(r"\b(multimodal look|multimodal-look)\b", scope_lower)
            or re.search(r"\b(analy[sz]e|inspect|review|read|extract)\b[\s\S]{0,80}\b(screenshot|image|pdf|diagram|mockup|wireframe|photo|screen capture|visual artifact)\b", scope_lower)
            or re.search(r"\b(screenshot|image|pdf|diagram|mockup|wireframe|photo|screen capture|visual artifact)\b[\s\S]{0,80}\b(analy[sz]e|inspect|review|read|extract)\b", scope_lower)
        )
    )
    explicit_artistry = bool(
        re.search(r"\b(artistry studio|artistry-studio)\b", scope_lower)
        or (re.search(r"\b(naming|tagline|tone|messaging|brand voice|creative concept|aesthetic direction|ideation)\b", scope_lower) and not large_product_build_task_observed)
    )
    required_specialist_lanes = ordered_unique(
        (["visual-forge"] if explicit_visual else [])
        + (["writing-desk"] if explicit_writing else [])
        + (["multimodal-look"] if explicit_multimodal else [])
        + (["artistry-studio"] if explicit_artistry else [])
    )
    recommended_specialist_lanes = ordered_unique(
        [
            lane
            for lane, pattern in [
                ("visual-forge", r"\b(ui|ux|frontend|css|layout|responsive|visual|design|accessibility)\b"),
                ("writing-desk", r"\b(docs?|documentation|readme|architecture|validation|guide|tests?)\b"),
                ("artistry-studio", r"\b(naming|tone|messaging|brand|creative|aesthetic)\b"),
            ]
            if large_product_build_task_observed and re.search(pattern, scope_lower) and lane not in required_specialist_lanes
        ]
    )
    if single_session_scope_declared:
        required_specialist_lanes = []
        recommended_specialist_lanes = []
    missing_required_specialist_lanes = [lane for lane in required_specialist_lanes if lane not in observed_specialist_lanes]
    unobserved_recommended_specialist_lanes = [lane for lane in recommended_specialist_lanes if lane not in observed_specialist_lanes]
    patch_master_swarm_count = max(
        patch_master_started_count,
        invocation_counts.get("Patch Master", 0),
        invocation_counts.get("patch-master", 0),
        invocation_counts.get("xgc:patch-master", 0),
        len([name for name in route_agents if name in {"Patch Master", "patch-master", "xgc:patch-master"}]),
    )
    patch_master_swarm_observed = patch_master_swarm_count >= 2
    specialist_lane_expected = bool(required_specialist_lanes or recommended_specialist_lanes)
    specialist_fanout_observed = bool(
        specialist_lane_expected and (observed_specialist_lanes or patch_master_swarm_observed)
    )
    specialist_fanout_covered_by_patch_master = bool(
        patch_master_swarm_observed and not missing_required_specialist_lanes and unobserved_recommended_specialist_lanes
    )
    specialist_fanout_partial = bool(
        (missing_required_specialist_lanes or (unobserved_recommended_specialist_lanes and not specialist_fanout_covered_by_patch_master))
    )
    specialist_fanout_status = "not_applicable"
    specialist_fanout_reason = None
    if not specialist_lane_expected:
        specialist_fanout_status = "not_applicable"
        specialist_fanout_reason = "single_session_scope_declared" if single_session_scope_declared else "no_specialist_scope_detected"
    elif missing_required_specialist_lanes:
        specialist_fanout_status = "missing_required"
        specialist_fanout_reason = f"missing required specialist lane(s): {', '.join(missing_required_specialist_lanes)}"
    elif specialist_fanout_observed and not unobserved_recommended_specialist_lanes:
        specialist_fanout_status = "complete"
        specialist_fanout_reason = "all expected specialist lanes were observed"
    elif specialist_fanout_covered_by_patch_master:
        specialist_fanout_status = "covered_by_patch_master_swarm"
        specialist_fanout_reason = f"recommended specialist lane(s) not observed but Patch Master swarm covered execution: {', '.join(unobserved_recommended_specialist_lanes)}"
    elif unobserved_recommended_specialist_lanes:
        specialist_fanout_status = "partial"
        specialist_fanout_reason = f"recommended specialist lane(s) were not observed: {', '.join(unobserved_recommended_specialist_lanes)}"

    return {
        "large_product_build_task_observed": large_product_build_task_observed,
        "single_session_scope_declared": single_session_scope_declared,
        "specialist_lane_expected": specialist_lane_expected,
        "required_specialist_lanes": required_specialist_lanes,
        "recommended_specialist_lanes": recommended_specialist_lanes,
        "observed_specialist_lanes": observed_specialist_lanes,
        "missing_required_specialist_lanes": missing_required_specialist_lanes,
        "unobserved_recommended_specialist_lanes": unobserved_recommended_specialist_lanes,
        "specialist_fanout_observed": specialist_fanout_observed,
        "specialist_fanout_partial": specialist_fanout_partial,
        "specialist_fanout_covered_by_patch_master": specialist_fanout_covered_by_patch_master,
        "specialist_fanout_status": specialist_fanout_status,
        "specialist_fanout_reason": specialist_fanout_reason,
        "patch_master_swarm_observed": patch_master_swarm_observed,
        "patch_master_swarm_count": patch_master_swarm_count,
    }


def classify_foundation_failure_line(line):
    if re.search(r"^\d{4}-\d{2}-\d{2}T[^\s]+\s+(sessionStart|agentStop|subagentStop|preToolUse|postToolUse|sessionEnd)\s+\{", line):
        return None
    if is_foundation_noise_line(line):
        return None
    if is_planning_or_advisory_line(line):
        return None
    if is_code_or_example_line(line):
        return None
    if re.search(r"\bUnable to load available models list\b", line, re.IGNORECASE):
        return "copilot-model-list"
    if re.search(
        r"\bAccess denied by policy settings\b|\bCopilot CLI policy setting\b|\borganization has restricted Copilot access\b|\bCopilot subscription does not include this feature\b|\bsubscription does not include this feature\b|\brequired policies have not been enabled\b|\bCopilot Pro trials have been temporarily paused\b|\bupgrade your account\b|\brevert to Copilot Free\b",
        line,
        re.IGNORECASE,
    ):
        return "copilot-policy"
    if re.search(r"\bAuthorization error,\s*you may need to run\s+/login\b|\byou may need to run\s+/login\b", line, re.IGNORECASE):
        return "copilot-auth"
    if re.search(r"\b(copilot|github copilot|provider|model list|prompt generation)\b", line, re.IGNORECASE) and re.search(
        r"\bnot authenticated\b|\bauthentication required\b|\bauthentication failed\b|\blogin required\b|\bplease log in\b|\bsign in\b|\bunauthorized\b|\bforbidden\b|\b401\b|\b403\b",
        line,
        re.IGNORECASE,
    ):
        return "copilot-auth"
    # Missing GitHub repository identity should be tracked separately from app/auth foundation failures.
    if re.search(r"\bGitHub repository name is required\b|\bFailed to load memories for prompt: Error:\s*GitHub repository name is required\b", line, re.IGNORECASE):
        return None
    if re.search(r"\borchestra-dual-runtime\b|\bcopilot-cli-plugin\b|legacy hook plugin|stale legacy hook", line, re.IGNORECASE):
        return "legacy-plugin-conflict"
    if re.search(r"\bscripts/(pre-tool-use|session-start|session-end|prompt-submitted|agent-stop|subagent-stop|error-occurred)\.mjs\b|Cannot find module .*scripts/[^ \n'\"]+\.mjs|node\s+\./scripts/[^ \t\"'`]+\.mjs\b", line, re.IGNORECASE):
        return "bootstrap-hook-path"
    if re.search(r"\b(bash|zsh|sh):\s+(\./)?scripts/(hooks/)?(pre-tool-use|session-start|agent-stop|subagent-stop|error-occurred)\.sh:\s+No such file or directory\b", line, re.IGNORECASE):
        return "bootstrap-hook-path"
    if re.search(r"\b(runtime config mismatch|hook path mismatch|hooks/hooks\.json.*mismatch|xgc-hooks\.json.*mismatch|generated hook.*drift)\b", line, re.IGNORECASE):
        return "runtime-config-mismatch"
    if re.search(r"\b(write EPIPE|EPIPE|broken pipe)\b", line, re.IGNORECASE):
        return "runtime-transport"
    if is_malformed_task_payload_line(line):
        return "task-payload"
    if re.search(r"\bFailed to load built-in agent\b|definitions/[A-Za-z0-9._:-]+\.agent\.ya?ml\b", line, re.IGNORECASE):
        return "runtime-tool-execution"
    if is_runtime_tooling_issue_line(line):
        return "runtime-tool-execution"
    if not re.search(r"\b(error|failed|failure|panic|exception|invalid|cannot|unable|timeout|timed out)\b", line, re.IGNORECASE):
        return None
    if re.search(r"\b(materializ(?:e|ation).*failed|profile materialization failed|copy.*hooks.*failed|install.*plugin.*failed)\b", line, re.IGNORECASE):
        return "tooling-materialization"
    if re.search(
        r"\b(hook\.end|hook execution|preToolUse|sessionStart|agentStop|errorOccurred|finalizeSessionSummary)\b.*\b(failed|error|Cannot find module|deferred_finalizer_error)\b",
        line,
        re.IGNORECASE,
    ):
        return "hook-execution"
    if re.search(r"\b(EADDRINUSE|address already in use|port\s+\d+\s+.*in use)\b", line, re.IGNORECASE):
        return "startability-port-conflict"
    if re.search(r"\b(ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|page\.goto:\s*net::ERR_CONNECTION_REFUSED|playwright web server did not become ready)\b", line, re.IGNORECASE):
        return "startability"
    if re.search(r"\b(seed|seeding|db seed|prisma db seed)\b", line, re.IGNORECASE):
        return "seed-data"
    if re.search(r"\b(prisma|schema|migration|migrate|db push|database|sqlite|datasource)\b", line, re.IGNORECASE):
        return "schema-db"
    if re.search(r"\b(npm install|pnpm install|yarn install|bun install|dependency|dependencies|package-lock|package\.json|ERESOLVE|ENOENT)\b", line, re.IGNORECASE):
        return "dependency-tooling"
    if re.search(r"\b(next build|build|compile|compiled|type error|typescript|tsc|lint|eslint)\b", line, re.IGNORECASE):
        return "build-typecheck"
    if re.search(
        r"\b(auth|authentication|authorization|middleware|NEXTAUTH|AUTH_SECRET|credentials)\b"
        r"|\bsession\s+(token|cookie|secret|auth|credential|expired|invalid)\b"
        r"|\b(auth|login)\s+session\b",
        line,
        re.IGNORECASE,
    ):
        return "auth-session"
    if re.search(r"\b(validation harness|validation_exit|validation state|strict mode violation|locator resolved to|expected to receive|got:)\b", line, re.IGNORECASE):
        return "validation-harness"
    if re.search(r"\b(playwright|browser|dev server|localhost|startability|startable|server|server did not become ready)\b", line, re.IGNORECASE):
        return "browser-smoke"
    return None


BOOTSTRAP_FOUNDATION_CLASSES = {
    "bootstrap-hook-path",
    "runtime-config-mismatch",
    "tooling-materialization",
    "legacy-plugin-conflict",
    "hook-execution",
    "copilot-auth",
    "copilot-model-list",
    "copilot-policy",
    "runtime-transport",
    "task-payload",
    "runtime-tool-execution",
}

RECOVERABLE_VALIDATION_FOUNDATION_CLASSES = {
    "browser-smoke",
    "startability",
    "startability-port-conflict",
    "build-typecheck",
    "validation-harness",
    "dependency-tooling",
    "schema-db",
    "seed-data",
}


def summarize_foundation_failure_signals(text):
    counts = {}
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
        and not is_prompt_or_requirement_line(line)
        and not is_planning_or_advisory_line(line)
        and not is_foundation_noise_line(line)
    ]
    validation_port_conflict_observed = any(
        re.search(r"\b(EADDRINUSE|address already in use|port\s+\d+\s+.*in use)\b", line, re.IGNORECASE)
        for line in lines
    )
    validation_server_readiness_failure_observed = bool(
        validation_port_conflict_observed
        or any(re.search(
            r"\b(ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|page\.goto:\s*net::ERR_CONNECTION_REFUSED|playwright web server did not become ready)\b",
            line,
            re.IGNORECASE,
        ) for line in lines)
    )
    for line in lines:
        failure_class = classify_foundation_failure_line(line)
        if not failure_class:
            continue
        counts[failure_class] = counts.get(failure_class, 0) + 1

    foundation_failure_classes = sorted(counts)
    repeated_classes = sorted(failure_class for failure_class, count in counts.items() if count > 1)
    repeated_foundation_failure_observed = len(repeated_classes) > 0
    copilot_auth_failure_observed = "copilot-auth" in foundation_failure_classes
    copilot_model_list_failure_observed = "copilot-model-list" in foundation_failure_classes
    copilot_policy_failure_observed = "copilot-policy" in foundation_failure_classes
    preflight_blocker_observed = (
        copilot_auth_failure_observed
        or copilot_model_list_failure_observed
        or copilot_policy_failure_observed
    )
    if copilot_auth_failure_observed and copilot_model_list_failure_observed and copilot_policy_failure_observed:
        preflight_blocker_kind = "auth-and-model-and-policy"
    elif copilot_auth_failure_observed and copilot_model_list_failure_observed:
        preflight_blocker_kind = "auth-and-model"
    elif copilot_auth_failure_observed and copilot_policy_failure_observed:
        preflight_blocker_kind = "auth-and-policy"
    elif copilot_model_list_failure_observed and copilot_policy_failure_observed:
        preflight_blocker_kind = "model-and-policy"
    elif copilot_auth_failure_observed:
        preflight_blocker_kind = "auth"
    elif copilot_model_list_failure_observed:
        preflight_blocker_kind = "model-list"
    elif copilot_policy_failure_observed:
        preflight_blocker_kind = "policy"
    else:
        preflight_blocker_kind = None
    preflight_blocker_reason = None
    if preflight_blocker_observed:
        for line in text.splitlines():
            if classify_foundation_failure_line(line) in {"copilot-auth", "copilot-model-list", "copilot-policy"}:
                preflight_blocker_reason = line.strip()[:240]
                break
    bootstrap_failure_observed = any(failure_class in BOOTSTRAP_FOUNDATION_CLASSES for failure_class in foundation_failure_classes)
    runtime_config_mismatch_observed = "runtime-config-mismatch" in foundation_failure_classes
    tooling_materialization_failure_observed = "tooling-materialization" in foundation_failure_classes
    legacy_hook_plugin_conflict_observed = "legacy-plugin-conflict" in foundation_failure_classes
    hook_execution_failure_observed = "hook-execution" in foundation_failure_classes or "bootstrap-hook-path" in foundation_failure_classes
    app_foundation_failure_observed = any(failure_class not in BOOTSTRAP_FOUNDATION_CLASSES for failure_class in foundation_failure_classes)
    foundation_recovery_suggested = repeated_foundation_failure_observed or validation_server_readiness_failure_observed
    if repeated_foundation_failure_observed:
        foundation_recovery_reason = f"repeated foundation failure class(es): {', '.join(repeated_classes)}"
    elif validation_port_conflict_observed:
        foundation_recovery_reason = "validation startability failed because the requested port was already in use"
    elif validation_server_readiness_failure_observed:
        foundation_recovery_reason = "validation startability failed because the dev server was not reachable"
    else:
        foundation_recovery_reason = None
    return {
        "repeated_foundation_failure_observed": repeated_foundation_failure_observed,
        "foundation_recovery_suggested": foundation_recovery_suggested,
        "foundation_failure_classes": foundation_failure_classes,
        "foundation_recovery_reason": foundation_recovery_reason,
        "bootstrap_failure_observed": bootstrap_failure_observed,
        "runtime_config_mismatch_observed": runtime_config_mismatch_observed,
        "tooling_materialization_failure_observed": tooling_materialization_failure_observed,
        "legacy_hook_plugin_conflict_observed": legacy_hook_plugin_conflict_observed,
        "hook_execution_failure_observed": hook_execution_failure_observed,
        "copilot_auth_failure_observed": copilot_auth_failure_observed,
        "copilot_model_list_failure_observed": copilot_model_list_failure_observed,
        "copilot_policy_failure_observed": copilot_policy_failure_observed,
        "preflight_blocker_observed": preflight_blocker_observed,
        "preflight_blocker_kind": preflight_blocker_kind,
        "preflight_blocker_reason": preflight_blocker_reason,
        "app_foundation_failure_observed": app_foundation_failure_observed,
        "validation_port_conflict_observed": validation_port_conflict_observed,
        "validation_server_readiness_failure_observed": validation_server_readiness_failure_observed,
    }


def apply_recovered_validation_foundation_truth(data):
    if data.get("validation_status") != "passed" or not data.get("validation_recovered_after_failures_observed"):
        return data
    classes = data.get("foundation_failure_classes")
    if not isinstance(classes, list):
        return data
    active_classes = [
        failure_class
        for failure_class in classes
        if failure_class not in RECOVERABLE_VALIDATION_FOUNDATION_CLASSES
    ]
    recovered_classes = sorted(
        {
            failure_class
            for failure_class in classes
            if failure_class in RECOVERABLE_VALIDATION_FOUNDATION_CLASSES
        }
    )
    if not recovered_classes:
        return data

    data["foundation_failure_classes"] = active_classes
    data["recovered_foundation_failure_classes"] = recovered_classes
    data["bootstrap_failure_observed"] = any(
        failure_class in BOOTSTRAP_FOUNDATION_CLASSES for failure_class in active_classes
    )
    data["runtime_config_mismatch_observed"] = "runtime-config-mismatch" in active_classes
    data["tooling_materialization_failure_observed"] = "tooling-materialization" in active_classes
    data["legacy_hook_plugin_conflict_observed"] = "legacy-plugin-conflict" in active_classes
    data["hook_execution_failure_observed"] = (
        "hook-execution" in active_classes or "bootstrap-hook-path" in active_classes
    )
    data["app_foundation_failure_observed"] = any(
        failure_class not in BOOTSTRAP_FOUNDATION_CLASSES for failure_class in active_classes
    )
    data["validation_port_conflict_observed"] = (
        "startability-port-conflict" in active_classes and bool(data.get("validation_port_conflict_observed"))
    )
    data["validation_server_readiness_failure_observed"] = (
        bool({"startability", "startability-port-conflict", "browser-smoke"} & set(active_classes))
        and bool(data.get("validation_server_readiness_failure_observed"))
    )

    reason_classes = []
    reason = data.get("foundation_recovery_reason")
    if isinstance(reason, str):
        match = re.search(r"class\(es\):\s*(.+)$", reason)
        if match:
            reason_classes = [part.strip() for part in match.group(1).split(",") if part.strip()]
    active_repeated_classes = sorted([failure_class for failure_class in reason_classes if failure_class in active_classes])
    data["repeated_foundation_failure_observed"] = bool(active_repeated_classes)
    if active_repeated_classes:
        data["foundation_recovery_reason"] = (
            f"repeated foundation failure class(es): {', '.join(active_repeated_classes)}"
        )
        data["foundation_recovery_suggested"] = True
    elif data.get("validation_server_readiness_failure_observed"):
        data["foundation_recovery_suggested"] = True
    else:
        data["foundation_recovery_suggested"] = False
        data["foundation_recovery_reason"] = None
    return data


def classify_integration_owned_surfaces(files):
    touched = []
    for file_path in files:
        normalized = str(file_path).replace("\\", "/")
        while normalized.startswith("./"):
            normalized = normalized[2:]
        if any(pattern.search(normalized) for pattern in INTEGRATION_OWNED_SURFACE_PATTERNS):
            touched.append(normalized)
    return sorted(dict.fromkeys(touched))


EVENT_EVIDENCE_PATTERN = re.compile(
    r"ownership leak allowed reason|agent_id:|track progress with\s+/tasks|Agent started in background|Execution status:|shared[-\s]surface|integration[-\s]owned surface|integration[-\s]class|integration[-\s]scale|multi[-\s]session|multi[-\s]surface|cross[-\s]surface|foundation readiness|foundation freeze|foundation risk|foundation not ready|baseline unknown|unstable foundation|GitHub repository name is required|Authorization error|you may need to run\s+/login|Unable to load available models list|Access denied by policy settings|Copilot CLI policy setting|Copilot Pro trials have been temporarily paused|upgrade your account|Cannot find module|scripts/[^ \n'\"]+\.mjs|orchestra-dual-runtime|copilot-cli-plugin|legacy hook plugin|stale legacy hook|hook path mismatch|runtime config mismatch|materialization failed|view\s+/tmp/|posix_spawn failed|(?:npm|pnpm|yarn|bun)\s+create\s+vite|Failed to load built-in agent|definitions/[A-Za-z0-9._:-]+\.agent\.ya?ml|EADDRINUSE|address already in use|ERR_CONNECTION_REFUSED|connection refused|dev server did not become ready|prisma|schema|migration|migrate|db push|database|sqlite|datasource|seed|npm install|dependency|package-lock|ERESOLVE|next build|type error|typescript|tsc|lint|eslint|auth|session|middleware|NEXTAUTH|AUTH_SECRET|playwright|strict mode violation|validation_exit|dev server|startability|429|rate limit|user_model_rate_limited|502|unicorn",
    re.IGNORECASE,
)


def collect_event_evidence_text(events, include_prompt_text=True):
    chunks = []

    def collect_prompt_text(entry):
        data = entry.get("data") if isinstance(entry, dict) else {}
        if not isinstance(data, dict):
            return
        for key in ("content", "prompt", "text"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                chunks.append(strip_embedded_agent_instructions(value))
                return

    def visit(value):
        if isinstance(value, str):
            if EVENT_EVIDENCE_PATTERN.search(value):
                chunks.append(value)
            return
        if isinstance(value, dict):
            for nested_value in value.values():
                visit(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value:
                visit(nested_value)

    for entry in events:
        if isinstance(entry, dict) and entry.get("type") in {"assistant.message", "user.message", "prompt.submitted", "prompt_submitted"}:
            if entry.get("type") in {"user.message", "prompt.submitted", "prompt_submitted"}:
                if not include_prompt_text:
                    continue
                collect_prompt_text(entry)
                continue
            visit(entry.get("data"))
            continue
        visit(entry.get("data") if isinstance(entry, dict) else entry)

    return "\n".join(chunks)


def collect_validation_evidence_text(events, process_log_text=""):
    chunks = []

    def visit(value):
        if isinstance(value, str):
            chunks.append(value)
            return
        if isinstance(value, dict):
            for nested_value in value.values():
                visit(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value:
                visit(nested_value)

    def collect_string_paths(value, paths):
        if not isinstance(value, dict):
            return
        for path_parts in paths:
            current = value
            for part in path_parts:
                if not isinstance(current, dict):
                    current = None
                    break
                current = current.get(part)
            if isinstance(current, str) and current.strip():
                chunks.append(current)

    for entry in events:
        if not isinstance(entry, dict):
            continue
        entry_type = entry.get("type")
        data = entry.get("data")
        if not isinstance(data, dict):
            continue
        if entry_type == "assistant.message":
            collect_string_paths(data, [["content"], ["text"], ["message"], ["summary"]])
            continue
        if entry_type == "hook.end":
            visit(data)
            continue
        if entry_type == "tool.execution_complete":
            collect_string_paths(
                data,
                [
                    ["content"],
                    ["text"],
                    ["output"],
                    ["stdout"],
                    ["stderr"],
                    ["detailedContent"],
                    ["result"],
                    ["result", "content"],
                    ["result", "text"],
                    ["result", "output"],
                    ["result", "stdout"],
                    ["result", "stderr"],
                    ["result", "detailedContent"],
                ],
            )
    if process_log_text:
        chunks.append(process_log_text)
    return "\n".join(chunk for chunk in chunks if chunk)


def is_prompt_or_requirement_line(line):
    normalized = line.strip()
    if not normalized:
        return False
    if re.search(
        r"^(?:Build|Create|Implement|Use this exact prompt|Product vision|Routing intent|Stack requirements|Core product areas|UX and design requirements|Implementation quality|Validation|README|Deliverables|Assumptions|Test Plan|Single Copilot Prompt)\b",
        normalized,
        re.IGNORECASE,
    ):
        return True
    if re.search(r"^(?:[-*]|\d+[.)])\s+\S+", normalized):
        return True
    if re.search(r"^(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b.*(?:→|->)\s*(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b", normalized, re.IGNORECASE):
        return True
    return bool(
        re.search(r"\b(prompt|requirements|vision|deliverables|assumptions|walkthrough|architecture|microcopy|brand tone)\b", normalized, re.IGNORECASE)
        and not re.search(r"^(?:npm|npx|pnpm|yarn|bun|vitest|playwright|next|prisma)\b", normalized, re.IGNORECASE)
    )


def strip_embedded_agent_instructions(text):
    return re.sub(r"<agent_instructions>[\s\S]*?</agent_instructions>", "", text or "", flags=re.IGNORECASE).strip()


def collect_scope_text(events):
    latest = None

    for entry in events:
        if not isinstance(entry, dict) or entry.get("type") not in {
            "prompt.submitted",
            "prompt_submitted",
            "user.message",
        }:
            continue
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        for key in ("content", "prompt", "text"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                latest = strip_embedded_agent_instructions(value)
                break

    return latest or ""


def parse_payload(raw):
    try:
        data = json.loads(raw)
    except Exception:
        return {}

    if isinstance(data, dict):
        nested = data.get("input")
        if isinstance(nested, dict) and "sessionId" not in data:
            return nested
        return data
    return {}


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def isoformat(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso_from_ms(value):
    try:
        return isoformat(datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc))
    except Exception:
        return None


def load_flat_yaml(file_path):
    data = {}
    if not file_path.exists():
        return data

    for line in file_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith(" ") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if value in {"true", "false"}:
            data[key] = value == "true"
            continue
        if value == "null":
            data[key] = None
            continue
        if re.fullmatch(r"-?\d+", value):
            data[key] = int(value)
            continue
        if value.startswith("[") or value.startswith("{"):
            try:
                data[key] = json.loads(value)
                continue
            except Exception:
                pass
        if value.startswith('"') and value.endswith('"'):
            try:
                data[key] = json.loads(value)
                continue
            except Exception:
                pass
        data[key] = value
    return data


def format_yaml_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if value is None:
        return "null"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)

    text = str(value)
    return json.dumps(text, ensure_ascii=False)


def write_flat_yaml(file_path, data):
    ordered_keys = [key for key in FIELD_ORDER if key in data]
    ordered_keys.extend(sorted(key for key in data if key not in FIELD_ORDER))
    lines = [f"{key}: {format_yaml_value(data[key])}" for key in ordered_keys]
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def repo_owned_workspace_yaml_path(cwd, git_root):
    root = git_root if isinstance(git_root, str) and git_root else cwd
    if not isinstance(root, str) or not root:
        return None
    return Path(root) / ".xgc" / "validation" / "workspace.yaml"


def ensure_repo_local_exclude(repo_root):
    try:
        root = Path(repo_root)
        git_dir = root / ".git"
        if not git_dir.exists() or not git_dir.is_dir():
            return
        exclude_path = git_dir / "info" / "exclude"
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        existing = exclude_path.read_text(encoding="utf-8") if exclude_path.exists() else ""
        if re.search(r"(?m)^\.xgc/$", existing):
            return
        suffix = "" if not existing or existing.endswith("\n") else "\n"
        exclude_path.write_text(f"{existing}{suffix}.xgc/\n", encoding="utf-8")
    except OSError:
        return


def write_workspace_truth_snapshots(session_workspace_yaml, repo_workspace_yaml, data):
    session_data = dict(data)
    session_data["operator_truth_source"] = "session-state-workspace"
    session_data["source_session_workspace_yaml"] = str(session_workspace_yaml)
    if repo_workspace_yaml:
        session_data["validation_workspace_yaml"] = str(repo_workspace_yaml)
    write_flat_yaml(session_workspace_yaml, session_data)
    write_session_summary_text(session_workspace_yaml.parent / "SESSION_SUMMARY.txt", session_data)

    if repo_workspace_yaml:
        ensure_repo_local_exclude(repo_workspace_yaml.parent.parent.parent)
        repo_data = dict(data)
        repo_data["operator_truth_source"] = "repo-owned-validation-workspace"
        repo_data["validation_workspace_yaml"] = str(repo_workspace_yaml)
        repo_data["source_session_workspace_yaml"] = str(session_workspace_yaml)
        try:
            write_flat_yaml(repo_workspace_yaml, repo_data)
        except OSError as exc:
            print(
                f"Warning: failed to write repo-owned workspace snapshot {repo_workspace_yaml}: {exc}",
                file=sys.stderr,
            )


def summary_count(value):
    return len(value) if isinstance(value, list) else 0


def render_summary_list(values, limit=8):
    if not isinstance(values, list) or not values:
        return "none"
    rendered = [str(value) for value in values[:limit]]
    if len(values) > limit:
        rendered.append(f"... +{len(values) - limit} more")
    return ", ".join(rendered)


def write_session_summary_text(file_path, data):
    try:
        lines = [
            "X for GitHub Copilot Session Summary",
            "",
            f"Session id: {data.get('id') or 'unknown'}",
            f"CWD: {data.get('cwd') or 'unknown'}",
            f"Final status: {data.get('final_status') or 'unknown'}",
            f"Summary finalization: {data.get('summary_finalization_status') or 'unknown'}",
            f"Summary authority: {data.get('summary_authority') or 'unknown'}",
            f"Archive completeness: {data.get('archive_completeness') or 'unknown'}",
            f"Session outcome: {data.get('session_outcome') or 'unknown'}",
            f"Validation status: {data.get('validation_status') or 'unknown'}",
            f"Route: {data.get('route_summary') or 'unobserved'}",
            f"Route source: {data.get('route_summary_source') or 'unknown'}",
            f"Execution owner: {data.get('execution_owner') or 'unknown'}",
            f"Committed repo changed: {data.get('committed_repo_changed')}",
            f"Working tree clean: {data.get('working_tree_clean')}",
            f"Committed diff source: {data.get('committed_diff_source') or 'unknown'}",
            f"Committed repo files: {summary_count(data.get('committed_repo_files'))}",
            f"Working-tree repo files: {summary_count(data.get('repo_working_tree_files'))}",
            f"Session-state files: {summary_count(data.get('session_state_files'))}",
            f"Validation artifact files: {summary_count(data.get('validation_artifact_files'))}",
            f"Process log: {data.get('process_log') or 'unknown'}",
            "",
            f"Authority reasons: {render_summary_list(data.get('summary_authority_reasons'))}",
            f"Archive reasons: {render_summary_list(data.get('archive_completeness_reasons'))}",
            f"Route agents: {render_summary_list(data.get('route_agents'))}",
            f"Committed files: {render_summary_list(data.get('committed_repo_files'))}",
            f"Working-tree files: {render_summary_list(data.get('repo_working_tree_files'))}",
        ]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"Warning: failed to write session summary text {file_path}: {exc}", file=sys.stderr)


def read_events(transcript_path):
    events = []
    if not transcript_path or not transcript_path.exists():
        return events
    for line in transcript_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            continue
    return events


def event_type_seen(events, event_type):
    return any(entry.get("type") == event_type for entry in events)


def subagent_failure_seen(events):
    return any(entry.get("type") == "subagent.failed" for entry in events)


def terminal_hook_seen(events, event_name):
    for entry in reversed(events):
        if entry.get("type") not in {"hook.start", "hook.end"}:
            continue
        data = entry.get("data")
        if isinstance(data, dict) and data.get("hookType") == event_name:
            return True
    return False


def is_terminal_finalization_event(event_name, stop_reason=None):
    if event_name == "agentStop":
        return True
    if event_name == "subagentStop":
        return stop_reason in TERMINAL_STOP_REASONS
    return False


def is_session_terminal_finalization_event(event_name, stop_reason=None, events=None):
    if event_name == "agentStop":
        return True
    if event_name == "subagentStop":
        # A subagentStop can refresh already-terminal truth after session.shutdown
        # lands, but by itself it only means a child lane finished.
        return stop_reason in TERMINAL_STOP_REASONS and event_type_seen(events or [], "session.shutdown")
    return False


def terminal_stop_hook_observed(events):
    return terminal_hook_seen(events, "agentStop") or terminal_hook_seen(events, "subagentStop")


def read_events_with_terminal_settle(transcript_path, event_name, stop_reason=None):
    events = read_events(transcript_path)
    if (
        not is_terminal_finalization_event(event_name, stop_reason)
        or event_type_seen(events, "session.shutdown")
        or not terminal_hook_seen(events, event_name)
    ):
        return events

    try:
        wait_seconds = float(os.environ.get("XGC_FINALIZER_SHUTDOWN_WAIT_SECONDS", "3"))
    except ValueError:
        wait_seconds = 3.0
    if wait_seconds <= 0:
        return events

    deadline = time.monotonic() + min(wait_seconds, 10.0)
    while time.monotonic() < deadline:
        time.sleep(0.15)
        events = read_events(transcript_path)
        if event_type_seen(events, "session.shutdown"):
            break
    return events


def latest_event_timestamp(events):
    latest = None
    for entry in events:
        timestamp = parse_iso(entry.get("timestamp"))
        if timestamp and (latest is None or timestamp > latest):
            latest = timestamp
    return latest


def build_agent_invocations(events):
    invocations = []
    invocation_counts = {}
    active = set()
    pending_selected = {}

    def record(agent_name, timestamp):
        invocations.append({"agent_name": agent_name, "timestamp": timestamp})
        invocation_counts[agent_name] = invocation_counts.get(agent_name, 0) + 1

    for entry in events:
        event_type = entry.get("type")
        if event_type not in {"subagent.selected", "subagent.started", "subagent.completed"}:
            continue
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        agent_name = data.get("agentDisplayName") or data.get("agentName")
        if not isinstance(agent_name, str) or not agent_name:
            continue
        timestamp = parse_iso(entry.get("timestamp"))

        if event_type == "subagent.selected":
            if agent_name not in active and agent_name not in pending_selected:
                record(agent_name, timestamp)
                pending_selected[agent_name] = timestamp
            continue

        if event_type == "subagent.started":
            if agent_name in pending_selected:
                pending_selected.pop(agent_name, None)
                active.add(agent_name)
                continue
            if agent_name not in active:
                record(agent_name, timestamp)
                active.add(agent_name)
            continue

        if agent_name in pending_selected:
            pending_selected.pop(agent_name, None)
            continue
        if agent_name not in active:
            record(agent_name, pending_selected.get(agent_name) or timestamp)
        active.discard(agent_name)
        pending_selected.pop(agent_name, None)

    return invocations, invocation_counts


def summarize_direct_tool_execution(events):
    tool_execution_count = 0
    write_tool_count = 0
    bash_tool_count = 0
    session_shutdown_observed = False
    session_shutdown_type = None
    routine_shutdown_during_open_turn_observed = False
    session_shutdown_code_changes_observed = False
    session_shutdown_lines_added = None
    session_shutdown_lines_removed = None
    session_shutdown_files_modified = []
    assistant_turn_open = False

    for entry in events:
        event_type = entry.get("type")
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        if event_type == "assistant.turn_start":
            assistant_turn_open = True
            continue
        if event_type == "assistant.turn_end":
            assistant_turn_open = False
            continue
        if event_type == "tool.execution_start":
            tool_execution_count += 1
            tool_name = data.get("toolName")
            if tool_name == "bash":
                bash_tool_count += 1
            if isinstance(tool_name, str) and tool_name in WRITE_LIKE_TOOLS:
                write_tool_count += 1
            continue

        if event_type == "session.shutdown":
            session_shutdown_observed = True
            shutdown_type = data.get("shutdownType")
            if isinstance(shutdown_type, str) and shutdown_type:
                session_shutdown_type = shutdown_type
            if assistant_turn_open and str(session_shutdown_type or "").lower() == "routine":
                routine_shutdown_during_open_turn_observed = True
            code_changes = data.get("codeChanges") if isinstance(data.get("codeChanges"), dict) else None
            if code_changes:
                session_shutdown_code_changes_observed = True
                if isinstance(code_changes.get("linesAdded"), int):
                    session_shutdown_lines_added = code_changes.get("linesAdded")
                if isinstance(code_changes.get("linesRemoved"), int):
                    session_shutdown_lines_removed = code_changes.get("linesRemoved")
                files_modified = code_changes.get("filesModified")
                if isinstance(files_modified, list):
                    session_shutdown_files_modified.extend(
                        str(file_path) for file_path in files_modified if isinstance(file_path, str) and file_path
                    )

    session_shutdown_files_modified = sorted(dict.fromkeys(session_shutdown_files_modified))
    return {
        "direct_tool_execution_observed": tool_execution_count > 0 or session_shutdown_code_changes_observed,
        "direct_tool_events_observed": tool_execution_count > 0,
        "tool_execution_count": tool_execution_count,
        "write_tool_count": write_tool_count,
        "bash_tool_count": bash_tool_count,
        "session_shutdown_observed": session_shutdown_observed,
        "session_shutdown_type": session_shutdown_type,
        "routine_shutdown_during_open_turn_observed": routine_shutdown_during_open_turn_observed,
        "session_shutdown_code_changes_observed": session_shutdown_code_changes_observed,
        "session_shutdown_files_modified": session_shutdown_files_modified,
        "session_shutdown_lines_added": session_shutdown_lines_added,
        "session_shutdown_lines_removed": session_shutdown_lines_removed,
    }


def summarize_runtime_models(events):
    first_user_event_index = None
    session_current_model = None
    model_changes = []
    session_level_models = []
    agent_tool_models = []
    model_metric_models = []
    post_prompt_models = []

    for index, entry in enumerate(events):
        event_type = entry.get("type")
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        if (
            first_user_event_index is None
            and event_type in {"user.message", "prompt.submitted", "prompt_submitted"}
            and not is_model_control_user_event(data)
        ):
            first_user_event_index = index

        if event_type == "session.model_change":
            new_model = data.get("newModel")
            if isinstance(new_model, str) and new_model:
                model_changes.append((index, new_model))
                session_level_models.append(new_model)
                if first_user_event_index is not None and index >= first_user_event_index:
                    post_prompt_models.append(new_model)
            continue

        if event_type == "session.tools_updated":
            model = data.get("model")
            if isinstance(model, str) and model:
                session_level_models.append(model)
                if first_user_event_index is not None and index >= first_user_event_index:
                    post_prompt_models.append(model)
            continue

        if event_type in {"tool.execution_complete", "tool.execution_start"}:
            model = nested_string(
                data,
                [
                    ["model"],
                    ["properties", "model"],
                    ["toolTelemetry", "properties", "model"],
                ],
            )
            if isinstance(model, str) and model:
                agent_tool_models.append(model)
            continue

        if event_type == "session.shutdown":
            model_metrics = data.get("modelMetrics")
            if isinstance(model_metrics, dict):
                model_metric_models.extend([model for model in model_metrics.keys() if isinstance(model, str) and model])
            current_model = data.get("currentModel")
            if isinstance(current_model, str) and current_model:
                session_current_model = current_model
                session_level_models.append(current_model)
                if first_user_event_index is not None and index >= first_user_event_index:
                    post_prompt_models.append(current_model)

    observed_runtime_models = ordered_unique(collapse_consecutive(session_level_models))
    observed_agent_tool_models = ordered_unique(collapse_consecutive(agent_tool_models))
    if first_user_event_index is None:
        requested_runtime_model = model_changes[-1][1] if model_changes else None
    else:
        pre_prompt_models = [model for change_index, model in model_changes if change_index < first_user_event_index]
        requested_runtime_model = pre_prompt_models[-1] if pre_prompt_models else (model_changes[-1][1] if model_changes else None)
    post_prompt_observed_runtime_models = ordered_unique(collapse_consecutive(post_prompt_models))
    effective_requested_model = requested_runtime_model or (observed_runtime_models[0] if observed_runtime_models else None)
    if post_prompt_observed_runtime_models:
        runtime_models_for_mismatch = post_prompt_observed_runtime_models
    elif first_user_event_index is not None and effective_requested_model:
        runtime_models_for_mismatch = [effective_requested_model]
    else:
        runtime_models_for_mismatch = observed_runtime_models
    mixed_model_session_observed = bool(
        len(runtime_models_for_mismatch) > 1
        or (effective_requested_model and session_current_model and session_current_model != effective_requested_model)
    )
    non_requested_model_usage_observed = bool(
        effective_requested_model
        and any(model != effective_requested_model for model in runtime_models_for_mismatch)
    )
    model_identity_baseline = effective_requested_model or session_current_model
    if not model_identity_baseline and len(runtime_models_for_mismatch) == 1:
        model_identity_baseline = runtime_models_for_mismatch[0]
    expected_tool_models = expected_runtime_tool_models_for_root(model_identity_baseline)
    unexpected_tool_models = [
        model for model in observed_agent_tool_models if model not in expected_tool_models
    ]
    tool_model_identity_mismatch_observed = bool(unexpected_tool_models)

    return {
        "requested_runtime_model": effective_requested_model,
        "session_current_model": session_current_model,
        "observed_runtime_models": observed_runtime_models,
        "post_prompt_observed_runtime_models": post_prompt_observed_runtime_models,
        "observed_agent_tool_models": observed_agent_tool_models,
        "observed_model_metric_models": ordered_unique(collapse_consecutive(model_metric_models)),
        "mixed_model_session_observed": mixed_model_session_observed,
        "non_requested_model_usage_observed": non_requested_model_usage_observed,
        "model_identity_mismatch_observed": non_requested_model_usage_observed or tool_model_identity_mismatch_observed,
    }


def is_model_control_user_event(data):
    if not isinstance(data, dict):
        return False
    content = data.get("content")
    if not isinstance(content, str):
        content = data.get("text") if isinstance(data.get("text"), str) else None
    if not isinstance(content, str):
        return False
    return bool(re.match(r"^\s*/model(?:\s+|$)", content))


AGENT_POLICY_IDS_BY_DISPLAY_NAME = {
    "Repo Master": "repo-master",
    "Repo Scout": "repo-scout",
    "Ref Index": "ref-index",
    "Milestone": "milestone",
    "Triage": "triage",
    "Patch Master": "patch-master",
    "Required Check": "required-check",
    "Merge Gate": "merge-gate",
    "Maintainer": "maintainer",
    "Visual Forge": "visual-forge",
    "Writing Desk": "writing-desk",
    "Multimodal Look": "multimodal-look",
    "Artistry Studio": "artistry-studio",
}


def normalize_agent_policy_id(agent_name):
    if not isinstance(agent_name, str):
        return None
    if agent_name in AGENT_POLICY_IDS_BY_DISPLAY_NAME:
        return AGENT_POLICY_IDS_BY_DISPLAY_NAME[agent_name]
    return agent_name.strip().lower().replace("xgc:", "")


def resolve_expected_agent_model(agent_id, root_model):
    if not agent_id:
        return None
    root = root_model if isinstance(root_model, str) and root_model else "claude-sonnet-4.6"
    if agent_id == "repo-master":
        return root
    if agent_id in {"milestone", "triage", "maintainer"}:
        return "claude-opus-4.6" if root == "claude-opus-4.6" else "claude-sonnet-4.6"
    if agent_id in {"patch-master", "merge-gate", "required-check", "multimodal-look"}:
        return "gpt-5.4"
    if agent_id in {"repo-scout", "ref-index"}:
        return "gpt-5-mini" if root in {"gpt-5-mini", "gpt-4.1"} else "gpt-5.4-mini"
    if agent_id in {"visual-forge", "artistry-studio"}:
        return "google/gemini-3.1-pro"
    if agent_id == "writing-desk":
        return "google/gemini-3-flash"
    return None


def expected_runtime_tool_models_for_root(root_model):
    """Return model-policy-resolved child models that are valid in one XGC run.

    A root GPT session is still expected to call Claude planner lanes, GPT
    execution lanes, mini grounding lanes, and fixed specialist lanes. Treating
    every tool model that differs from the root as a mismatch makes successful
    TUI sessions look broken, so model identity truth checks for models outside
    the resolved policy set instead.
    """
    agent_ids = sorted(set(AGENT_POLICY_IDS_BY_DISPLAY_NAME.values()))
    models = []
    for agent_id in agent_ids:
        model = resolve_expected_agent_model(agent_id, root_model)
        if isinstance(model, str) and model:
            models.append(model)
    if isinstance(root_model, str) and root_model:
        models.append(root_model)
    return set(ordered_unique(models))


def nested_string(value, paths):
    for path_parts in paths:
        current = value
        for part in path_parts:
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(part)
        if isinstance(current, str) and current.strip():
            return current.strip()
    return None


def normalize_tool_arguments(arguments):
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            return {"_raw": arguments}
        if isinstance(parsed, dict):
            return parsed
        return {"_raw": arguments}
    return {}


def collect_tool_result_text(data):
    chunks = []

    def visit(value):
        if isinstance(value, str) and value:
            chunks.append(value)
            return
        if isinstance(value, dict):
            for nested_value in value.values():
                visit(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value:
                visit(nested_value)

    for key in ("content", "text", "output", "detailedContent", "result"):
        if isinstance(data, dict) and key in data:
            visit(data.get(key))
    return "\n".join(chunks)


def summarize_generic_result_reader(events):
    generic_result_reader_observed = False
    planner_result_read_proxy_observed = False
    planner_result_read_output_too_large_observed = False
    generic_reader_task_ids = set()

    for entry in events:
        if not isinstance(entry, dict):
            continue
        event_type = entry.get("type")
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        tool_name = data.get("toolName")

        if event_type == "tool.execution_start" and tool_name == "task":
            args = normalize_tool_arguments(data.get("arguments"))
            agent_type = str(args.get("agent_type") or args.get("agentType") or "").strip().lower()
            prompt = str(args.get("prompt") or args.get("_raw") or "")
            description = str(args.get("description") or args.get("name") or "")
            combined = "\n".join([agent_type, description, prompt])
            if agent_type in {"general-purpose", "general purpose", "general-purpose agent"} and re.search(
                r"\bread_agent\b|\bread\s+milestone\b|\bmilestone\s+(?:agent\s+)?result\b",
                combined,
                re.IGNORECASE,
            ):
                generic_result_reader_observed = True
                tool_call_id = data.get("toolCallId")
                if isinstance(tool_call_id, str) and tool_call_id:
                    generic_reader_task_ids.add(tool_call_id)
                if re.search(r"\bmilestone\b", combined, re.IGNORECASE):
                    planner_result_read_proxy_observed = True
            continue

        if event_type == "tool.execution_complete":
            parent_tool_call_id = data.get("parentToolCallId")
            content_text = collect_tool_result_text(data)
            if (
                isinstance(parent_tool_call_id, str)
                and parent_tool_call_id in generic_reader_task_ids
                and re.search(r"\boutput too large to read at once\b", content_text, re.IGNORECASE)
            ):
                planner_result_read_output_too_large_observed = True

    return {
        "generic_result_reader_observed": generic_result_reader_observed,
        "planner_result_read_proxy_observed": planner_result_read_proxy_observed,
        "planner_result_read_output_too_large_observed": planner_result_read_output_too_large_observed,
    }


def summarize_agent_model_policy_mismatches(events, root_model):
    mismatches = []
    seen = set()
    for entry in events:
        data = entry.get("data") if isinstance(entry, dict) and isinstance(entry.get("data"), dict) else {}
        telemetry_agent_name = nested_string(
            data,
            [
                ["restrictedProperties", "agent_name"],
                ["restrictedProperties", "agentName"],
                ["toolTelemetry", "restrictedProperties", "agent_name"],
                ["toolTelemetry", "restrictedProperties", "agentName"],
                ["toolTelemetry", "restrictedProperties", "agentDisplayName"],
            ],
        )
        telemetry_model = nested_string(
            data,
            [
                ["properties", "model"],
                ["toolTelemetry", "properties", "model"],
            ],
        )
        # Copilot task-tool completion events often carry `data.model` for the
        # parent/root model. Treat only telemetry-scoped agent model fields as
        # authoritative child-agent evidence; otherwise GPT-root sessions can be
        # falsely reported as if Milestone itself ran on GPT.
        if not telemetry_agent_name or not telemetry_model:
            continue
        agent_name = nested_string(
            data,
            [
                ["restrictedProperties", "agent_name"],
                ["restrictedProperties", "agentName"],
                ["toolTelemetry", "restrictedProperties", "agent_name"],
                ["toolTelemetry", "restrictedProperties", "agentName"],
                ["toolTelemetry", "restrictedProperties", "agentDisplayName"],
            ],
        )
        observed_model = nested_string(
            data,
            [
                ["properties", "model"],
                ["toolTelemetry", "properties", "model"],
            ],
        )
        if not agent_name or not observed_model:
            continue
        expected_model = resolve_expected_agent_model(normalize_agent_policy_id(agent_name), root_model)
        if not expected_model or expected_model == observed_model:
            continue
        message = f"{agent_name} expected {expected_model} observed {observed_model}"
        if message in seen:
            continue
        seen.add(message)
        mismatches.append(message)
    return {
        "agent_model_policy_mismatch_observed": len(mismatches) > 0,
        "agent_model_policy_mismatch_count": len(mismatches),
        "agent_model_policy_mismatches": mismatches,
    }


def should_downgrade_authority_for_agent_model_policy(data):
    if not data.get("agent_model_policy_mismatch_observed"):
        return False
    requested_model = data.get("requested_runtime_model")
    mismatches = data.get("agent_model_policy_mismatches")
    if isinstance(requested_model, str) and isinstance(mismatches, list) and mismatches:
        observed_models = []
        for mismatch in mismatches:
            if not isinstance(mismatch, str):
                continue
            match = re.search(r"\bobserved\s+(.+)$", mismatch)
            if match:
                observed_models.append(match.group(1).strip())
        if observed_models and all(model == requested_model for model in observed_models):
            return False
    if data.get("mixed_model_session_observed") or data.get("non_requested_model_usage_observed"):
        return True
    observed_models = data.get("observed_runtime_models")
    if isinstance(requested_model, str) and isinstance(observed_models, list) and observed_models == [requested_model]:
        return False
    return True


def summarize_route(events, evidence_text="", scope_text=""):
    invocations, invocation_counts = build_agent_invocations(events)
    route_agents = [entry["agent_name"] for entry in invocations]
    executed_route_agents = ordered_unique(
        [
            (entry.get("data") or {}).get("agentDisplayName") or (entry.get("data") or {}).get("agentName")
            for entry in events
            if entry.get("type") in {"subagent.started", "subagent.completed"}
            and isinstance(entry.get("data"), dict)
            and isinstance((entry.get("data") or {}).get("agentDisplayName") or (entry.get("data") or {}).get("agentName"), str)
        ]
    )
    direct_tool_summary = summarize_direct_tool_execution(events)
    patch_master_completed_at = None
    patch_master_started_at = None
    patch_master_started_count = 0
    patch_master_completed_count = 0
    active_patch_master_runs = 0
    post_execution_root_write_count = 0
    post_execution_root_patch_observed = False
    execution_owner_active_root_write_count = 0
    execution_owner_active_root_patch_observed = False

    for entry in events:
        event_type = entry.get("type")
        timestamp = parse_iso(entry.get("timestamp"))
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}

        if event_type in {"subagent.selected", "subagent.started", "subagent.completed"}:
            agent_name = data.get("agentDisplayName") or data.get("agentName")
            if event_type == "subagent.started" and agent_name == "Patch Master":
                patch_master_started_count += 1
                active_patch_master_runs += 1
                patch_master_completed_at = None
                if timestamp and (patch_master_started_at is None or timestamp < patch_master_started_at):
                    patch_master_started_at = timestamp
            if event_type == "subagent.completed" and agent_name == "Patch Master":
                patch_master_completed_count += 1
                active_patch_master_runs = max(0, active_patch_master_runs - 1)
                if timestamp:
                    patch_master_completed_at = timestamp
            continue

        if event_type == "tool.execution_start" and timestamp and patch_master_started_at:
            tool_name = data.get("toolName")
            parent_tool_call_id = data.get("parentToolCallId")
            if isinstance(parent_tool_call_id, str) and parent_tool_call_id:
                continue
            if not isinstance(tool_name, str) or tool_name not in WRITE_LIKE_TOOLS:
                continue
            if active_patch_master_runs > 0 and timestamp >= patch_master_started_at:
                execution_owner_active_root_write_count += 1
                if tool_name == "apply_patch":
                    execution_owner_active_root_patch_observed = True
            elif patch_master_completed_at and timestamp >= patch_master_completed_at:
                post_execution_root_write_count += 1
                if tool_name == "apply_patch":
                    post_execution_root_patch_observed = True

    key_agents = ordered_unique(route_agents)
    patch_index = route_agents.index("Patch Master") if "Patch Master" in route_agents else -1
    post_execution_planner_reopen_agents = (
        collapse_consecutive([name for name in route_agents[patch_index + 1 :] if name in POST_EXECUTION_PLANNER_REOPEN_AGENTS])
        if patch_index >= 0
        else []
    )
    post_execution_generic_agents = (
        collapse_consecutive([name for name in route_agents[patch_index + 1 :] if is_built_in_generic_agent(name)])
        if patch_index >= 0
        else []
    )
    post_execution_built_in_agents = post_execution_generic_agents
    post_execution_ownership_leak_observed = bool(
        post_execution_planner_reopen_agents
        or post_execution_generic_agents
        or post_execution_root_write_count > 0
        or execution_owner_active_root_write_count > 0
    )
    ownership_leak_allowed_reason = (
        extract_ownership_leak_allowed_reason(evidence_text) if post_execution_ownership_leak_observed else None
    )
    execution_owner = "Patch Master" if patch_index >= 0 else None
    ownership_transferred_to_execution = execution_owner == "Patch Master"
    structured_background_agents = summarize_structured_background_agent_ids(events)
    background_agents_started = extract_background_execution_agent_ids(evidence_text)
    background_agents_completed = sorted(
        dict.fromkeys(extract_completed_background_agent_ids(evidence_text) + structured_background_agents["completed"])
    )
    background_agents_read = sorted(
        dict.fromkeys(extract_read_background_agent_ids(evidence_text) + structured_background_agents["read"])
    )
    background_execution_agent_ids = background_agents_started
    background_execution_agent_observed = bool(
        background_agents_started
        or re.search(r"\bAgent started in background\b|\btrack progress with\s+/tasks\b", evidence_text, re.IGNORECASE)
    )
    execution_owner_blocked_observed = bool(has_execution_status_blocked(evidence_text))
    execution_owner_ready_for_return_observed = bool(has_execution_status_ready_for_return(evidence_text))
    patch_master_completion_observed = bool(
        patch_master_completed_count > 0
        or re.search(r"\bPatch Master\b[\s\S]{0,120}\bcompleted\b", evidence_text, re.IGNORECASE)
        or has_execution_status_closure(evidence_text)
    )
    execution_owner_agent_id = None
    for agent_id in background_agents_started:
        if re.search(r"patch|execution|implement|build|commit", agent_id, re.IGNORECASE):
            execution_owner_agent_id = agent_id
            break
    if execution_owner_agent_id is None and len(background_agents_started) == 1:
        execution_owner_agent_id = background_agents_started[0]
    execution_owner_completed = bool(
        (execution_owner_agent_id and execution_owner_agent_id in background_agents_completed)
        or patch_master_completion_observed
    )
    execution_owner_result_read = bool(execution_owner_agent_id and execution_owner_agent_id in background_agents_read)
    finalized_before_execution_owner_read = bool(
        ownership_transferred_to_execution
        and execution_owner_agent_id
        and execution_owner_completed
        and not execution_owner_result_read
        and not execution_owner_ready_for_return_observed
        and not execution_owner_blocked_observed
    )
    blocking_background_agents_unresolved = []
    background_agent_unresolved_ids = []
    for agent_id in background_agents_started:
        if agent_id not in background_agents_completed and agent_id not in background_agents_read:
            background_agent_unresolved_ids.append(agent_id)
        if not re.search(r"patch|execution|implement|build|commit|visual|writing|artistry|multimodal", agent_id, re.IGNORECASE):
            continue
        if agent_id == execution_owner_agent_id and (
            execution_owner_result_read or execution_owner_ready_for_return_observed or execution_owner_blocked_observed
        ):
            continue
        if agent_id not in background_agents_completed:
            blocking_background_agents_unresolved.append(agent_id)
        elif agent_id == execution_owner_agent_id and not execution_owner_result_read:
            blocking_background_agents_unresolved.append(agent_id)
    blocking_background_agents_unresolved = sorted(dict.fromkeys(blocking_background_agents_unresolved))
    background_agent_unresolved_ids = sorted(dict.fromkeys(background_agent_unresolved_ids))
    background_agent_unresolved_observed = bool(background_agent_unresolved_ids)
    post_execution_completion_gap_observed = bool(
        finalized_before_execution_owner_read or blocking_background_agents_unresolved
    )
    background_execution_agent_unresolved = bool(
        background_execution_agent_observed
        and ownership_transferred_to_execution
        and (
            blocking_background_agents_unresolved
            or (
                not (execution_owner_ready_for_return_observed or execution_owner_blocked_observed)
                and (patch_master_started_count == 0 or patch_master_completed_count < patch_master_started_count)
            )
        )
    )
    patch_master_handoff_without_completion_observed = bool(
        ownership_transferred_to_execution
        and patch_master_started_count > 0
        and patch_master_completed_count < patch_master_started_count
        and not (execution_owner_ready_for_return_observed or execution_owner_blocked_observed)
    )
    malformed_task_payload_observed = any(
        is_malformed_task_payload_line(line)
        for line in evidence_text.splitlines()
    )
    runtime_tooling_issues = summarize_runtime_tooling_issues(evidence_text)
    triage_invocations = [entry for entry in invocations if entry["agent_name"] == "Triage"]
    triage_duplicate_observed = len(triage_invocations) > 1
    execution_ready_handoff_seen_before_second_triage = False
    triage_duplicate_allowed_reason = None
    if triage_duplicate_observed:
        first_triage_timestamp = triage_invocations[0].get("timestamp")
        second_triage_timestamp = triage_invocations[1].get("timestamp")
        milestone_completion_timestamps = [
            parse_iso(entry.get("timestamp"))
            for entry in events
            if entry.get("type") == "subagent.completed"
            and isinstance(entry.get("data"), dict)
            and ((entry.get("data") or {}).get("agentDisplayName") or (entry.get("data") or {}).get("agentName")) == "Milestone"
        ]
        milestone_completion_timestamps = [timestamp for timestamp in milestone_completion_timestamps if timestamp]
        if second_triage_timestamp:
            execution_ready_handoff_seen_before_second_triage = any(
                timestamp < second_triage_timestamp and (not first_triage_timestamp or timestamp > first_triage_timestamp)
                for timestamp in milestone_completion_timestamps
            )
        if not execution_ready_handoff_seen_before_second_triage:
            triage_duplicate_allowed_reason = "no_post_triage_milestone_completion_observed_before_second_triage"

    route_summary_source = "started_with_fallbacks" if route_agents else "name_list_fallback"
    route_summary = " -> ".join(route_agents) if route_agents else None
    if not route_agents and direct_tool_summary["direct_tool_execution_observed"]:
        route_summary_source = (
            "raw_tool_events_fallback"
            if direct_tool_summary["direct_tool_events_observed"]
            else "session_shutdown_code_changes_fallback"
        )
        route_summary = "Direct Copilot Session"
    generic_result_reader_summary = summarize_generic_result_reader(events)
    specialist_fanout = summarize_specialist_fanout(
        evidence_text,
        route_agents,
        invocation_counts,
        patch_master_started_count,
        scope_text=scope_text,
        executed_route_agents=executed_route_agents,
    )

    return {
        "route_summary_source": route_summary_source,
        "route_agents": route_agents,
        "key_agents": key_agents,
        "route_summary": route_summary,
        **direct_tool_summary,
        "repo_scout_invocation_count": invocation_counts.get("Repo Scout", 0),
        "triage_invocation_count": invocation_counts.get("Triage", 0),
        "patch_master_invocation_count": invocation_counts.get("Patch Master", 0),
        "required_check_invocation_count": invocation_counts.get("Required Check", 0),
        "built_in_generic_agent_invocation_count": len([name for name in route_agents if is_built_in_generic_agent(name)]),
        "triage_duplicate_observed": triage_duplicate_observed,
        "triage_duplicate_allowed_reason": triage_duplicate_allowed_reason,
        "execution_ready_handoff_seen_before_second_triage": execution_ready_handoff_seen_before_second_triage,
        "patch_master_completed": patch_master_completed_at is not None,
        "patch_master_completed_at": isoformat(patch_master_completed_at) if patch_master_completed_at else None,
        "post_execution_planner_reopen_agents": post_execution_planner_reopen_agents,
        "post_execution_generic_agent_observed": len(post_execution_generic_agents) > 0,
        "post_execution_built_in_agent_observed": len(post_execution_built_in_agents) > 0,
        "post_execution_generic_agents": post_execution_generic_agents,
        "post_execution_built_in_agents": post_execution_built_in_agents,
        "post_execution_ownership_leak_observed": post_execution_ownership_leak_observed,
        "ownership_leak_allowed_reason": ownership_leak_allowed_reason,
        "execution_owner": execution_owner,
        "ownership_transferred_to_execution": ownership_transferred_to_execution,
        "background_execution_agent_observed": background_execution_agent_observed,
        "background_execution_agent_unresolved": background_execution_agent_unresolved,
        "background_agent_unresolved_observed": background_agent_unresolved_observed,
        "background_agent_unresolved_ids": background_agent_unresolved_ids,
        "background_execution_agent_ids": background_execution_agent_ids,
        "background_agents_started": background_agents_started,
        "background_agents_completed": background_agents_completed,
        "background_agents_read": background_agents_read,
        **generic_result_reader_summary,
        "blocking_background_agents_unresolved": blocking_background_agents_unresolved,
        "execution_owner_agent_id": execution_owner_agent_id,
        "execution_owner_result_read": execution_owner_result_read,
        "execution_owner_blocked_observed": execution_owner_blocked_observed,
        "finalized_before_execution_owner_read": finalized_before_execution_owner_read,
        "post_execution_completion_gap_observed": post_execution_completion_gap_observed,
        "patch_master_handoff_without_completion_observed": patch_master_handoff_without_completion_observed,
        "malformed_task_payload_observed": malformed_task_payload_observed,
        **runtime_tooling_issues,
        "post_execution_root_write_observed": post_execution_root_write_count > 0,
        "post_execution_root_patch_observed": post_execution_root_patch_observed,
        "post_execution_root_write_count": post_execution_root_write_count,
        "execution_owner_active_root_write_observed": execution_owner_active_root_write_count > 0,
        "execution_owner_active_root_write_count": execution_owner_active_root_write_count,
        "execution_owner_active_root_patch_observed": execution_owner_active_root_patch_observed,
        **specialist_fanout,
    }


def git_status_files(git_root):
    if not git_root or not Path(git_root).exists():
        return []
    result = subprocess.run(
        ["git", "-C", str(git_root), "status", "--porcelain", "--untracked-files=all"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []

    files = []
    for line in result.stdout.splitlines():
        if len(line) < 4:
            continue
        entry = line[3:].strip()
        if " -> " in entry:
            entry = entry.split(" -> ", 1)[1].strip()
        if entry:
            files.append(entry)
    return sorted(dict.fromkeys(files))


def git_head(git_root):
    if not git_root or not Path(git_root).exists():
        return None
    result = subprocess.run(
        ["git", "-C", str(git_root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value or None


def git_head_before(git_root, timestamp):
    if not git_root or not timestamp or not Path(git_root).exists():
        return None
    result = subprocess.run(
        ["git", "-C", str(git_root), "rev-list", "-n", "1", f"--before={isoformat(timestamp)}", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value or None


def git_files_changed_between(git_root, start_head, end_head):
    if not git_root or not start_head or not end_head or start_head == end_head:
        return []
    result = subprocess.run(
        ["git", "-C", str(git_root), "diff", "--name-only", f"{start_head}..{end_head}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(dict.fromkeys(line.strip() for line in result.stdout.splitlines() if line.strip()))


def git_files_committed_since(git_root, created_at):
    if not git_root or not created_at or not Path(git_root).exists():
        return []
    result = subprocess.run(
        ["git", "-C", str(git_root), "log", "--name-only", "--format=", f"--since={isoformat(created_at)}", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return sorted(dict.fromkeys(line.strip() for line in result.stdout.splitlines() if line.strip()))


def classify_repo_status_files(files):
    repo_working_tree_files = []
    session_state_files = []
    validation_artifact_files = []

    for entry in files:
        normalized = entry.strip().replace("\\", "/")
        if not normalized:
            continue
        if (
            normalized.startswith(".xgc/validation/")
            or normalized.startswith(".xgc/live-smoke/")
            or normalized.startswith("test-results/")
            or normalized.startswith("playwright-report/")
        ):
            validation_artifact_files.append(normalized)
            continue
        if normalized.startswith(".xgc/"):
            session_state_files.append(normalized)
            continue
        repo_working_tree_files.append(normalized)

    return {
        "repo_working_tree_files": sorted(dict.fromkeys(repo_working_tree_files)),
        "session_state_files": sorted(dict.fromkeys(session_state_files)),
        "validation_artifact_files": sorted(dict.fromkeys(validation_artifact_files)),
    }


def normalize_repo_code_path(file_path, cwd=None, git_root=None):
    normalized = str(file_path).strip().replace("\\", "/")
    if not normalized:
        return None

    candidate_roots = []
    for root in (git_root, cwd):
        if isinstance(root, str) and root:
            try:
                resolved = Path(root).resolve()
            except Exception:
                continue
            if resolved not in candidate_roots:
                candidate_roots.append(resolved)

    try:
        candidate_path = Path(normalized)
        if candidate_path.is_absolute():
            resolved_candidate = candidate_path.resolve()
            relative = None
            for root in candidate_roots:
                try:
                    relative = resolved_candidate.relative_to(root).as_posix()
                    break
                except ValueError:
                    continue
            if relative is None:
                return None
            normalized = relative
    except Exception:
        return None

    while normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized or normalized.startswith(".xgc/"):
        return None
    return normalized


def repo_code_files_from_paths(files, cwd=None, git_root=None):
    return sorted(
        dict.fromkeys(
            normalized
            for normalized in (normalize_repo_code_path(file_path, cwd, git_root) for file_path in files)
            if normalized
        )
    )


def repo_write_paths_from_events(events, cwd=None, git_root=None):
    paths = []
    for entry in events:
        if not isinstance(entry, dict) or entry.get("type") != "tool.execution_start":
            continue
        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        tool_name = data.get("toolName")
        if not isinstance(tool_name, str) or tool_name not in WRITE_LIKE_TOOLS:
            continue
        arguments = data.get("arguments")
        if isinstance(arguments, dict):
            for key in ("path", "file", "filePath", "targetPath"):
                value = arguments.get(key)
                if isinstance(value, str) and value:
                    paths.append(value)
            continue
        if isinstance(arguments, str):
            paths.extend(
                match.group(1).strip()
                for match in re.finditer(
                    r"^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$",
                    arguments,
                    re.MULTILINE,
                )
            )
    return repo_code_files_from_paths(paths, cwd, git_root)


def collect_relative_files(root, threshold=None):
    if not root or not root.exists():
        return []
    files = []
    for file_path in sorted(path for path in root.rglob("*") if path.is_file()):
        if threshold is not None and datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc) < threshold:
            continue
        files.append(file_path.relative_to(root).as_posix())
    return files


def useful_session_state_artifacts(files):
    useful_files = []
    baseline_files = {
        "events.jsonl",
        "workspace.yaml",
        "SESSION_SUMMARY.txt",
        "ORIGINAL_PATHS.txt",
        "MISSING_FILES.txt",
    }
    baseline_prefixes = (
        ".xgc/logs/",
        "logs/",
    )
    useful_prefixes = (
        "checkpoints/",
        "rewind-snapshots/",
    )
    useful_exact = {
        "plan.md",
    }

    for entry in files:
        normalized = str(entry).strip().replace("\\", "/")
        if not normalized:
            continue
        basename = normalized.rsplit("/", 1)[-1]
        if normalized in useful_exact or normalized.startswith(useful_prefixes):
            useful_files.append(normalized)
            continue
        if normalized in baseline_files or basename in baseline_files:
            continue
        if normalized.startswith(baseline_prefixes):
            continue

    return sorted(dict.fromkeys(useful_files))


def infer_profile_home_from_transcript(transcript_path):
    if not transcript_path:
        return ""
    session_state_dir = transcript_path.parent.parent
    if session_state_dir.name == "session-state":
        return str(session_state_dir.parent)
    return str(session_state_dir)


def find_process_log(profile_home, session_id, transcript_path, cwd):
    profile_homes = []
    for candidate_home in [profile_home, infer_profile_home_from_transcript(transcript_path)]:
        if candidate_home and candidate_home not in profile_homes:
            profile_homes.append(candidate_home)
    log_roots = []

    def add_log_root(candidate):
        if not candidate:
            return
        root = Path(str(candidate)).expanduser()
        for possible_root in [root, root / "logs"]:
            if possible_root not in log_roots:
                log_roots.append(possible_root)

    for env_name in ["XGC_PROCESS_LOG_ROOT", "XGC_COPILOT_LOG_DIR", "COPILOT_LOG_DIR", "COPILOT_LOG_ROOT", "XGC_LOG_ROOT"]:
        add_log_root(os.environ.get(env_name))
    for candidate_home in profile_homes:
        add_log_root(Path(candidate_home) / "logs")

    strong_needles = [session_id, str(transcript_path) if transcript_path else None]
    weak_needles = [cwd]
    best_match = None
    best_score = -1
    best_mtime = -1.0
    for log_root in log_roots:
        if not log_root.exists():
            continue
        candidates = sorted(log_root.glob("process-*.log"), key=lambda item: item.stat().st_mtime, reverse=True)
        for candidate in candidates:
            try:
                text = candidate.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            score = 0
            if any(needle and needle in text for needle in strong_needles):
                score = 2
            elif any(needle and needle in text for needle in weak_needles):
                score = 1
            if score == 0:
                continue
            mtime = candidate.stat().st_mtime
            if score > best_score or (score == best_score and mtime > best_mtime):
                best_match = (candidate, text)
                best_score = score
                best_mtime = mtime
    return best_match if best_match else (None, "")


def find_hooks_log(profile_home, cwd):
    candidates = []
    for env_name in ["XGC_LOG_ROOT"]:
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value).expanduser() / "hooks.log")
    if cwd:
        candidates.append(Path(str(cwd)).expanduser() / ".xgc" / "logs" / "hooks.log")
    if profile_home:
        candidates.append(Path(str(profile_home)).expanduser() / "logs" / "hooks.log")
    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate, candidate.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
    return None, ""


def extract_line_timestamp(line):
    match = re.search(r"\b(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\b", line)
    if not match:
        return None
    return parse_iso(match.group(1))


def filter_hooks_log_text_for_session(text, session_id, start_dt=None, end_dt=None):
    if not text:
        return ""
    filtered = []
    window_start = start_dt - timedelta(minutes=5) if start_dt else None
    window_end = end_dt + timedelta(minutes=5) if end_dt else None
    for line in text.splitlines():
        if not line.strip():
            continue
        if session_id and session_id in line:
            filtered.append(line)
            continue
        if re.search(r"\bsession(?:Id|_id)?\b", line, re.IGNORECASE):
            continue
        line_dt = extract_line_timestamp(line)
        if line_dt and (window_start is None or line_dt >= window_start) and (window_end is None or line_dt <= window_end):
            filtered.append(line)
    return "\n".join(filtered)


def extract_explicit_retry_count(line):
    match = re.search(r"\bretried\s+(\d+)\s+times\b", line, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"\b(?:retry|attempt)\s+(\d+)\s*(?:/|of)\s*\d+\b", line, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"\bretry(?:\s+count)?\s*[:=]\s*(\d+)\b", line, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def summarize_provider_retries(process_log):
    provider_retry_count = 0
    provider_retry_reason = None
    recovered_after_retry = False
    terminal_failure_after_retry = False
    last_retry_line = -1
    model_rate_limit_count = 0
    provider_502_count = 0

    for index, line in enumerate(process_log.splitlines()):
        if re.search(r"\b(user_model_rate_limited|rate limit(?:ed)?|status['\"]?:\s*429|\b429\b)", line, re.IGNORECASE):
            model_rate_limit_count += 1
            provider_retry_count += 1
            provider_retry_reason = provider_retry_reason or "model rate limit / 429"
            last_retry_line = index
            recovered_after_retry = False
        if re.search(r"\b(status['\"]?:\s*502|\b502\b|unicorn|bad gateway)\b", line, re.IGNORECASE):
            provider_502_count += 1
            provider_retry_count += 1
            provider_retry_reason = provider_retry_reason or "provider 502 / gateway error"
            last_retry_line = index
            recovered_after_retry = False

        retry_warning = re.search(
            r"Detected HTTP/2 GOAWAY error, resetting global dispatcher and retrying the request",
            line,
            re.IGNORECASE,
        )
        if retry_warning:
            provider_retry_count += 1
            provider_retry_reason = "HTTP/2 GOAWAY / 503 connection_error"
            last_retry_line = index
            recovered_after_retry = False
            terminal_failure_after_retry = False

        explicit_retry_count = extract_explicit_retry_count(line)
        if explicit_retry_count is not None:
            provider_retry_count = max(provider_retry_count, explicit_retry_count)
            provider_retry_reason = provider_retry_reason or "retryable provider transport error"
            if last_retry_line < 0:
                last_retry_line = index

        if last_retry_line >= 0 and index > last_retry_line and "--- End of group ---" in line:
            recovered_after_retry = True
        if re.search(r"Failed to get response from the AI model; retried \d+ times", line):
            terminal_failure_after_retry = True

    if provider_retry_count == 0:
        return {
            "provider_retry_observed": False,
            "provider_retry_state": "not-observed",
            "provider_retry_count": 0,
            "provider_retry_reason": None,
            "model_rate_limit_observed": False,
            "model_rate_limit_count": 0,
            "provider_502_observed": False,
            "provider_502_count": 0,
        }

    if terminal_failure_after_retry:
        state = "terminal-failure-after-retry"
    elif recovered_after_retry:
        state = "recovered-after-retry"
    else:
        state = "retry-in-progress"
    return {
        "provider_retry_observed": True,
        "provider_retry_state": state,
        "provider_retry_count": provider_retry_count,
        "provider_retry_reason": provider_retry_reason,
        "model_rate_limit_observed": model_rate_limit_count > 0,
        "model_rate_limit_count": model_rate_limit_count,
        "provider_502_observed": provider_502_count > 0,
        "provider_502_count": provider_502_count,
    }


def validation_failure_patterns():
    return [
        re.compile(r"\b(failed to compile|tests?\s+failed|test files?\s+\d+\s+failed|command failed|returned non-zero|exit code\s+[1-9]|npm ERR!|ELIFECYCLE)\b", re.IGNORECASE),
        re.compile(r"\b(\d+\s+failed\b|1 failed\b|strict mode violation|locator resolved to|ERR_CONNECTION_REFUSED|page\.goto:\s*net::ERR_CONNECTION_REFUSED)\b", re.IGNORECASE),
        re.compile(r"\b(AssertionError|TypeError|ReferenceError|SyntaxError|TimeoutError|test timeout|timed out waiting|expected .* received)\b", re.IGNORECASE),
        re.compile(r"\b(prisma|seed|seeding|typecheck|typescript|eslint|playwright|vitest|next build)\b.*\b(error|failed|failure|non-zero)\b", re.IGNORECASE),
        re.compile(r"\b(error|failed|failure|non-zero)\b.*\b(prisma|seed|seeding|typecheck|typescript|eslint|playwright|vitest|next build)\b", re.IGNORECASE),
    ]


def validation_pass_patterns(strong=False):
    strong_patterns = [
        re.compile(r"\b(no eslint warnings or errors|npm test passed|tests?\s+\d+\s+passed|test files?\s+\d+\s+passed|compiled successfully|build passed|validation passed|smoke test passed|playwright.*\bpassed|all required validation commands passed)\b", re.IGNORECASE),
        re.compile(r"^\s*(?:✓\s*)?\d+\s+passed\b", re.IGNORECASE),
        re.compile(r"^\s*(?:\d+[\.)]\s*)?`?(?:npm install|npx prisma generate|npx prisma db push --force-reset|npm run seed|npm run lint|npm test|npm run build|npx playwright test)`?\s*(?:✅|passed)\s*$", re.IGNORECASE),
        re.compile(r"^\s*all passed\.?\s*$", re.IGNORECASE),
    ]
    if strong:
        return strong_patterns
    return strong_patterns + [
        re.compile(r"\b(validation_exit\s*[:=]\s*0|validation_state\s*[:=]\s*done|state=done)\b", re.IGNORECASE),
    ]


def validation_signal_lines(text, patterns):
    signals = []
    for index, line in enumerate(text.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        if validation_signal_noise_line(stripped):
            continue
        if any(pattern.search(stripped) for pattern in patterns):
            signals.append({"index": index, "line": stripped[:240]})
    return signals


def validation_signal_noise_line(line):
    if validation_checkmark_result_line(line):
        return False
    return bool(
        is_prompt_or_requirement_line(line)
        or is_planning_or_advisory_line(line)
        or is_code_or_example_line(line)
        or validation_retrospective_failure_note_line(line)
        or re.search(r"\bAgent is still running after waiting\b", line, re.IGNORECASE)
        or (
            re.search(r"\bagent_id:\s*[^,\s]+", line, re.IGNORECASE)
            and re.search(r"\bstatus:\s*running\b", line, re.IGNORECASE)
            and re.search(r"\btool_calls_completed\b", line, re.IGNORECASE)
        )
        or re.search(r"\bFailed to load memories for prompt:\s*Error:\s*GitHub repository name is required\b", line, re.IGNORECASE)
        or re.search(r"\b(Command failed with exit code 128:\s*)?git rev-parse HEAD\b", line, re.IGNORECASE)
        or re.search(r"\bFailed to get current commit hash\b", line, re.IGNORECASE)
        or re.search(r"\bMCP transport for .* closed\b", line, re.IGNORECASE)
        or re.search(r"\bTransient error connecting to HTTP server .*\bfetch failed\b", line, re.IGNORECASE)
        or re.search(r"\bRetrying connection to HTTP server\b", line, re.IGNORECASE)
        or re.search(r"\b(Starting|Creating|Connecting) MCP client for\b", line, re.IGNORECASE)
        or re.search(r"\bMCP client for .* connected\b", line, re.IGNORECASE)
        or re.search(r"\bStarted MCP client for remote server\b", line, re.IGNORECASE)
        or re.search(r"\bGitHub MCP server configured after authentication\b", line, re.IGNORECASE)
    )


def validation_checkmark_result_line(line):
    return bool(
        re.search(
            r"^\s*(?:\d+[\.)]\s*)?`?(?:npm install|npx prisma generate|npx prisma db push --force-reset|npm run seed|npm run lint|npm test|npm run build|npx playwright test)`?\s*(?:✅|passed)\s*$",
            line,
            re.IGNORECASE,
        )
    )


def validation_retrospective_failure_note_line(line):
    """Ignore narrative notes about earlier failures once a run has recovered.

    Final summaries often include a "known limitation" or "raw validation notes"
    section that mentions an earlier failed command after the actual validation
    checklist has passed. Those notes should remain useful foundation-risk
    evidence, but they are not a fresh validation failure at the end of the
    stream.
    """
    retrospective_header = re.search(
        r"^\s*(?:[-*]\s*)?(?:raw validation notes?|known limitations?|known limitation / remaining uncertainty|remaining uncertainty|what remains uncertain)\b",
        line,
        re.IGNORECASE,
    )
    retrospective_recovery_note = (
        re.search(r"\b(initial|earlier|previous|prior|proven blocker|recovered|resolved via|resolved by|replaced with|narrowed include|narrowed exclude)\b", line, re.IGNORECASE)
        and re.search(r"\b(failed|failure|failures|error|errors|blocker|rejected)\b", line, re.IGNORECASE)
        and re.search(r"\b(validation|prisma|schema-engine|lint|eslint|vitest|playwright|build|test|db push)\b", line, re.IGNORECASE)
    )
    succeeds_after_workaround = re.search(r"\bso\b.*\b(succeeds|passes|is stabilized)\b", line, re.IGNORECASE) and re.search(
        r"\b(prisma|validation|command|wrapper|workaround)\b", line, re.IGNORECASE
    )
    return bool(retrospective_header or retrospective_recovery_note or succeeds_after_workaround)


def validation_failure_lines(text):
    failures = [signal["line"] for signal in validation_signal_lines(text, validation_failure_patterns())]
    return ordered_unique(failures)


def summarize_validation_status(text):
    validation_observed = bool(
        re.search(r"\b(validation_exit\s*[:=]\s*0|validation_state\s*[:=]\s*done|state=done)\b", text, re.IGNORECASE)
        or validation_signal_lines(text, validation_failure_patterns())
        or validation_signal_lines(text, validation_pass_patterns())
    )
    if not validation_observed:
        return {
            "validation_observed": False,
            "validation_status": "not-observed",
            "validation_raw_status": "not-observed",
            "validation_overclaim_observed": False,
            "validation_command_failures": [],
        }

    failure_signals = validation_signal_lines(text, validation_failure_patterns())
    pass_signals = validation_signal_lines(text, validation_pass_patterns())
    strong_pass_signals = validation_signal_lines(text, validation_pass_patterns(strong=True))
    command_failures = ordered_unique([signal["line"] for signal in failure_signals])
    failed = len(command_failures) > 0
    passed = len(pass_signals) > 0
    last_failure_index = max([signal["index"] for signal in failure_signals], default=-1)
    last_strong_pass_index = max([signal["index"] for signal in strong_pass_signals], default=-1)
    hard_failure_observed = any(
        re.search(r"\b(\d+\s+failed\b|strict mode violation|locator resolved to|AssertionError)\b", signal["line"], re.IGNORECASE)
        for signal in failure_signals
    )
    hard_recovery_observed = any(
        signal["index"] > last_failure_index
        and re.search(r"\b(npm test passed|tests?\s+\d+\s+passed|test files?\s+\d+\s+passed|playwright.*\bpassed|smoke test passed|all required validation commands passed)\b|^\s*(?:✓\s*)?\d+\s+passed\b|^\s*all passed\.?\s*$", signal["line"], re.IGNORECASE)
        for signal in strong_pass_signals
    )
    recovered_by_later_validation = failed and last_strong_pass_index > last_failure_index and (
        not hard_failure_observed or hard_recovery_observed
    )
    validation_overclaim_observed = failed and passed and not recovered_by_later_validation

    if failed and not recovered_by_later_validation:
        return {
            "validation_observed": True,
            "validation_status": "failed",
            "validation_raw_status": "failed",
            "validation_overclaim_observed": validation_overclaim_observed,
            "validation_command_failures": command_failures,
            "validation_recovered_after_failures_observed": False,
            "validation_recovery_source": None,
            "validation_recovered_command_failures": [],
        }
    if passed or recovered_by_later_validation:
        recovered = bool(recovered_by_later_validation)
        return {
            "validation_observed": True,
            "validation_status": "passed",
            "validation_raw_status": "failed" if recovered else "passed",
            "validation_overclaim_observed": False,
            "validation_command_failures": [],
            "validation_recovered_after_failures_observed": recovered,
            "validation_recovery_source": "raw-later-validation-pass" if recovered else None,
            "validation_recovered_command_failures": command_failures if recovered else [],
        }
    return {
        "validation_observed": True,
        "validation_status": "observed-unknown",
        "validation_raw_status": "observed-unknown",
        "validation_overclaim_observed": False,
        "validation_command_failures": [],
        "validation_recovered_after_failures_observed": False,
        "validation_recovery_source": None,
        "validation_recovered_command_failures": [],
    }


def summarize_validation_artifact_status(cwd, validation_artifact_files):
    if not isinstance(cwd, str) or not cwd:
        return {
            "validation_observed": False,
            "validation_status": "not-observed",
            "validation_source": None,
            "validation_command_failures": [],
        }
    workspace_root = Path(cwd)
    parsed_results = {}
    parsed_logs = {}

    for relative_path in validation_artifact_files or []:
        if not isinstance(relative_path, str) or not relative_path:
            continue
        absolute_path = workspace_root / relative_path
        try:
            text = absolute_path.read_text(errors="ignore")
        except OSError:
            continue
        if absolute_path.name == "RESULTS.env":
            for line in text.splitlines():
                match = re.match(r"^([A-Za-z0-9_.-]+)\s*=\s*(-?\d+)\s*$", line.strip())
                if match:
                    parsed_results[match.group(1)] = int(match.group(2))
            continue
        if absolute_path.suffix == ".log":
            match = re.search(r"## END [^\n]*\bexit=(-?\d+)\b", text)
            if match:
                parsed_logs[relative_path] = int(match.group(1))

    if parsed_results:
        failures = [f"{name}={exit_code}" for name, exit_code in sorted(parsed_results.items()) if exit_code != 0]
        return {
            "validation_observed": True,
            "validation_status": "failed" if failures else "passed",
            "validation_source": "validation-results-env",
            "validation_command_failures": failures,
        }
    if parsed_logs:
        failures = [f"{name} exit={exit_code}" for name, exit_code in sorted(parsed_logs.items()) if exit_code != 0]
        return {
            "validation_observed": True,
            "validation_status": "failed" if failures else "passed",
            "validation_source": "validation-log-exit-codes",
            "validation_command_failures": failures,
        }
    return {
        "validation_observed": False,
        "validation_status": "not-observed",
        "validation_source": None,
        "validation_command_failures": [],
    }


def merge_validation_summaries(raw_summary, artifact_summary):
    artifact_observed = bool(artifact_summary.get("validation_observed"))
    artifact_status = artifact_summary.get("validation_status")
    raw_failures = raw_summary.get("validation_command_failures") if isinstance(raw_summary.get("validation_command_failures"), list) else []
    raw_failed = raw_summary.get("validation_status") == "failed"
    if artifact_observed and artifact_status == "passed":
        return {
            "validation_observed": True,
            "validation_status": "passed",
            "validation_raw_status": raw_summary.get("validation_status") or "observed-unknown",
            "validation_overclaim_observed": False,
            "validation_command_failures": [],
            "validation_recovered_after_failures_observed": bool(raw_failed or raw_failures),
            "validation_recovery_source": artifact_summary.get("validation_source"),
            "validation_recovered_command_failures": raw_failures if raw_failed or raw_failures else [],
        }
    if artifact_observed and artifact_status == "failed":
        artifact_failures = artifact_summary.get("validation_command_failures") if isinstance(artifact_summary.get("validation_command_failures"), list) else []
        return {
            "validation_observed": True,
            "validation_status": "failed",
            "validation_raw_status": raw_summary.get("validation_status") or "observed-unknown",
            "validation_overclaim_observed": raw_summary.get("validation_overclaim_observed", False),
            "validation_command_failures": ordered_unique(artifact_failures + raw_failures),
            "validation_recovered_after_failures_observed": False,
            "validation_recovery_source": artifact_summary.get("validation_source"),
            "validation_recovered_command_failures": [],
        }
    return {
        **raw_summary,
        "validation_recovered_after_failures_observed": raw_summary.get("validation_recovered_after_failures_observed", False),
        "validation_recovery_source": raw_summary.get("validation_recovery_source"),
        "validation_recovered_command_failures": raw_summary.get("validation_recovered_command_failures", []),
    }


def summarize_session_outcome(
    final_status,
    summary_finalization_status,
    repo_code_changed,
    useful_artifacts_observed,
    validation_status,
    preflight_blocker_observed=False,
    preflight_blocker_kind=None,
    execution_handoff_without_observed_repo_diff=False,
    background_execution_agent_unresolved=False,
    background_agent_unresolved_observed=False,
    patch_master_handoff_without_completion_observed=False,
    post_execution_completion_gap_observed=False,
    execution_owner_blocked_observed=False,
    agent_model_policy_mismatch_observed=False,
    user_abort_observed=False,
    subagent_failure_observed=False,
    terminal_provider_failure_observed=False,
    large_product_build_task_observed=False,
    patch_master_invocation_count=0,
    planner_result_read_proxy_observed=False,
    specialist_fanout_status=None,
):
    if preflight_blocker_observed:
        detail = f"blocked_before_generation_{preflight_blocker_kind or 'preflight'}"
        if repo_code_changed or useful_artifacts_observed:
            return "partial-success", f"{detail}_with_useful_artifacts"
        return "blocked", detail

    if user_abort_observed:
        if repo_code_changed:
            return "partial-success", "user_aborted_with_repo_changes"
        return "incomplete", "user_aborted_before_completion"

    if terminal_provider_failure_observed or subagent_failure_observed:
        if repo_code_changed:
            return "partial-success", "terminal_failure_with_repo_changes"
        return "failure", "terminal_failure_without_repo_changes"

    if post_execution_completion_gap_observed:
        if repo_code_changed or useful_artifacts_observed:
            return "partial-success", "completed_with_unread_execution_owner_result"
        return "incomplete", "execution_owner_result_not_read"
    if background_execution_agent_unresolved:
        if repo_code_changed or useful_artifacts_observed:
            return "partial-success", "completed_with_background_execution_unresolved"
        return "incomplete", "background_execution_unresolved_without_repo_changes"
    if patch_master_handoff_without_completion_observed:
        return "incomplete", "patch_master_handoff_without_completion"
    if execution_owner_blocked_observed:
        if repo_code_changed or useful_artifacts_observed:
            return "partial-success", "completed_with_execution_owner_blocked"
        return "incomplete", "execution_owner_blocked"
    if large_product_build_task_observed and planner_result_read_proxy_observed and patch_master_invocation_count <= 0 and not repo_code_changed:
        return "incomplete", "planner_result_read_proxy_without_execution"
    if execution_handoff_without_observed_repo_diff and not repo_code_changed:
        return "incomplete", "execution_handoff_without_repo_changes"
    if large_product_build_task_observed and patch_master_invocation_count <= 0 and not repo_code_changed:
        return "incomplete", "large_product_execution_not_started"
    if background_agent_unresolved_observed and not repo_code_changed:
        return "incomplete", "background_agent_unresolved_without_repo_changes"
    if specialist_fanout_status == "missing_required" and (repo_code_changed or useful_artifacts_observed):
        return "partial-success", "missing_required_specialist_lane_with_repo_changes"

    if summary_finalization_status in {"partial", "heuristic"}:
        if repo_code_changed:
            return "partial-success", "partial_success_with_repo_changes"
        return "heuristic-summary", "summary_partial_or_heuristic"

    if final_status == "error":
        if repo_code_changed or useful_artifacts_observed:
            return "partial-success", "failure_with_useful_artifacts"
        return "failure", "terminal_error_without_useful_artifacts"

    if final_status == "stopped":
        if repo_code_changed:
            return "partial-success", "stopped_with_repo_changes"
        return "incomplete", "stopped_without_repo_changes"

    if final_status == "completed":
        if post_execution_completion_gap_observed:
            if repo_code_changed or useful_artifacts_observed:
                return "partial-success", "completed_with_unread_execution_owner_result"
            return "incomplete", "execution_owner_result_not_read"
        if background_execution_agent_unresolved:
            return "incomplete", "background_execution_unresolved_without_repo_changes"
        if patch_master_handoff_without_completion_observed:
            return "incomplete", "patch_master_handoff_without_completion"
        if execution_owner_blocked_observed:
            if repo_code_changed or useful_artifacts_observed:
                return "partial-success", "completed_with_execution_owner_blocked"
            return "incomplete", "execution_owner_blocked"
        if large_product_build_task_observed and planner_result_read_proxy_observed and patch_master_invocation_count <= 0:
            return "incomplete", "planner_result_read_proxy_without_execution"
        if execution_handoff_without_observed_repo_diff and not repo_code_changed:
            return "incomplete", "execution_handoff_without_repo_changes"
        if specialist_fanout_status == "missing_required":
            if repo_code_changed or useful_artifacts_observed:
                return "partial-success", "missing_required_specialist_lane_with_repo_changes"
            return "incomplete", "missing_required_specialist_lane"
        if agent_model_policy_mismatch_observed:
            return "partial-success", "completed_with_model_policy_mismatch"
        if validation_status == "failed":
            return "partial-success", "completed_but_validation_failed"
        if repo_code_changed:
            return "success", "completed_with_repo_changes"
        if large_product_build_task_observed and patch_master_invocation_count <= 0:
            return "incomplete", "large_product_execution_not_started"
        return "success", "completed_without_repo_changes"

    if repo_code_changed:
        return "partial-success", "incomplete_with_repo_changes"
    return "incomplete", "no_terminal_completion_observed"


def summarize_summary_authority(
    event_name,
    summary_finalization_status,
    events,
    route_summary,
    latest_event_dt,
    process_log_path,
    session_start_head,
    session_end_head,
    committed_diff_fallback_used,
    repo_code_changed,
    useful_artifacts_observed,
    validation_status,
    user_abort_observed=False,
    subagent_failure_observed=False,
    terminal_provider_failure_observed=False,
):
    reasons = []
    if summary_finalization_status == "error":
        if repo_code_changed or useful_artifacts_observed or validation_status == "passed":
            return "finalized_with_gaps", ["terminal error hook observed, but useful repo/session evidence was recovered"]
        return "failed", ["terminal error hook observed without useful repo/session recovery evidence"]
    if summary_finalization_status == "heuristic":
        return "heuristic", ["raw events were unavailable, so final summary is heuristic"]
    if summary_finalization_status == "partial":
        partial_reasons = []
        if route_summary.get("background_execution_agent_unresolved"):
            partial_reasons.append("background execution owner remained unresolved before finalization")
        if route_summary.get("background_agent_unresolved_observed"):
            partial_reasons.append("background agent remained unresolved before finalization")
        if route_summary.get("planner_result_read_proxy_observed"):
            partial_reasons.append("planner result was routed through a generic read-agent proxy")
        if route_summary.get("planner_result_read_output_too_large_observed"):
            partial_reasons.append("planner result read returned output-too-large instead of a compact handoff")
        if route_summary.get("execution_owner_blocked_observed"):
            partial_reasons.append("execution owner reported blocked before finalization")
        if route_summary.get("post_execution_completion_gap_observed"):
            partial_reasons.append("execution owner completed but its result was not read before finalization")
        return "partial", partial_reasons or ["session has not reached a terminal finalization hook"]
    if user_abort_observed:
        return "partial", ["user abort was observed before session shutdown"]

    if event_name == SESSION_SHUTDOWN_RECOVERY_EVENT:
        reasons.append("session.shutdown recovery finalized the run after Copilot exited without a terminal stop hook")
    if event_name not in TERMINAL_FINALIZATION_EVENTS:
        reasons.append("terminal stop hook was not observed")
    if route_summary.get("routine_shutdown_during_open_turn_observed"):
        reasons.append("routine session.shutdown occurred while an assistant turn was still open")
    if not events:
        reasons.append("raw events were unavailable")
    if route_summary.get("route_summary_source") == "raw_tool_events_fallback":
        reasons.append("direct single-session tool route was reconstructed from raw tool events")
    elif route_summary.get("route_summary_source") == "session_shutdown_code_changes_fallback":
        reasons.append("direct single-session route was inferred from session.shutdown code changes")
    elif route_summary.get("route_summary_source") != "started_with_fallbacks":
        reasons.append("route was reconstructed from fallback names rather than started events")
    if not route_summary.get("route_agents") and route_summary.get("route_summary_source") not in {
        "raw_tool_events_fallback",
        "session_shutdown_code_changes_fallback",
    }:
        reasons.append("route sequence was empty")
    if route_summary.get("background_execution_agent_unresolved"):
        reasons.append("background execution owner remained unresolved")
    if route_summary.get("background_agent_unresolved_observed"):
        reasons.append("background agent remained unresolved")
    if route_summary.get("post_execution_completion_gap_observed"):
        reasons.append("execution owner completed but its result was not read before finalization")
    if route_summary.get("planner_result_read_proxy_observed"):
        reasons.append("planner result was routed through a generic read-agent proxy")
    if route_summary.get("planner_result_read_output_too_large_observed"):
        reasons.append("planner result read returned output-too-large instead of a compact handoff")
    if route_summary.get("execution_owner_blocked_observed"):
        reasons.append("execution owner reported blocked before finalization")
    if subagent_failure_observed:
        reasons.append("subagent failure was observed")
    if terminal_provider_failure_observed:
        reasons.append("provider retry ended in a terminal failure")
    if latest_event_dt is None:
        reasons.append("latest event timestamp was unavailable")
    if not process_log_path:
        reasons.append("matching process log was unavailable")
    if not session_start_head or not session_end_head:
        reasons.append("git start/end HEAD evidence was unavailable")
    if committed_diff_fallback_used:
        reasons.append("committed repo files were inferred without a direct git start/end range")

    if reasons:
        return "finalized_with_gaps", reasons
    return "authoritative", ["terminal hook, raw events, route, process log, git heads, and finalizer evidence were all present"]


def summarize_archive_completeness(workspace_yaml, events, route_summary, process_log_path, summary_finalization_status, validation_summary):
    reasons = []
    if not events:
        reasons.append("raw events were unavailable")
    if not route_summary.get("route_summary"):
        reasons.append("route summary was unavailable")
    if not process_log_path:
        reasons.append("matching process log was unavailable")
    if validation_summary.get("validation_observed") and not validation_summary.get("validation_command_failures") and validation_summary.get("validation_status") == "observed-unknown":
        reasons.append("validation was observed but could not be classified")
    if route_summary.get("background_execution_agent_unresolved"):
        reasons.append("background execution owner remained unresolved")
    if route_summary.get("background_agent_unresolved_observed"):
        reasons.append("background agent remained unresolved")
    if route_summary.get("planner_result_read_proxy_observed"):
        reasons.append("planner result was routed through a generic read-agent proxy")
    if route_summary.get("post_execution_completion_gap_observed"):
        reasons.append("execution owner result was not read before finalization")
    if summary_finalization_status == "error":
        reasons.append("terminal error hook was observed")
    if summary_finalization_status in {"partial", "heuristic"}:
        reasons.append(f"summary finalization status is {summary_finalization_status}")

    if summary_finalization_status == "failed-finalization":
        return "failed-finalization", reasons or ["finalizer failed before writing a complete summary"]
    if not events:
        return "incomplete", reasons
    if reasons:
        return "partial", reasons
    return "complete", []


def load_probe_cache_lines(cache_file):
    if not cache_file.exists():
        return []
    return [line.rstrip("\n") for line in cache_file.read_text(encoding="utf-8").splitlines() if line.strip()]


def parse_probe_cache_line(line):
    parts = line.split("\t")
    if len(parts) >= 4:
        return {
            "repo_identity": parts[0],
            "kind": parts[1],
            "session_id": parts[2],
            "timestamp": parts[3],
        }
    if len(parts) >= 3:
        return {
            "repo_identity": parts[0],
            "kind": parts[1],
            "session_id": None,
            "timestamp": parts[2],
        }
    return None


def probe_cache_entry_matches_scope(entry, repo_identity, session_id):
    return (
        entry["repo_identity"] == repo_identity
        and (entry["session_id"] == session_id or entry["session_id"] is None)
    )


def record_probe_cache_kind(cache_file, existing_lines, repo_identity, kind, session_id, timestamp):
    if any(
        (
            parsed := parse_probe_cache_line(line)
        )
        and parsed["repo_identity"] == repo_identity
        and parsed["kind"] == kind
        and (parsed["session_id"] == session_id or parsed["session_id"] is None)
        for line in existing_lines
    ):
        return
    existing_lines.append(f"{repo_identity}\t{kind}\t{session_id}\t{timestamp}")


def count_probe_episodes(process_log):
    counts = {
        "memory_enabled_success_count": 0,
        "memory_enabled_404_count": 0,
        "memory_prompt_404_count": 0,
        "pr_success_count": 0,
        "pr_404_count": 0,
    }
    previous_kind = None
    for line in process_log.splitlines():
        current_kind = None
        if re.search(r"\bMemory enablement check:\s*enabled\b", line, re.IGNORECASE):
            current_kind = "memory_enabled_success_count"
        elif re.search(r"/internal/memory/[^ \n]+/enabled\b[^ \n]*.*\b404\b", line, re.IGNORECASE):
            current_kind = "memory_enabled_404_count"
        elif re.search(r"/internal/memory/[^ \n]+/prompt\b[^ \n]*.*\b404\b", line, re.IGNORECASE):
            current_kind = "memory_prompt_404_count"
        elif re.search(r"/pulls\?head=.*\s-\s2\d\d\b", line, re.IGNORECASE):
            current_kind = "pr_success_count"
        elif re.search(r"/pulls\?head=.*\b404\b", line, re.IGNORECASE):
            current_kind = "pr_404_count"

        if not current_kind:
            previous_kind = None
            continue
        if current_kind != previous_kind:
            counts[current_kind] += 1
        previous_kind = current_kind
    return counts


def parse_process_log_summary(process_log, repo_identity, session_id, config_home):
    episode_counts = count_probe_episodes(process_log)
    memory_success_count = episode_counts["memory_enabled_success_count"]
    pr_success_count = episode_counts["pr_success_count"]
    memory_404_count = episode_counts["memory_enabled_404_count"]
    memory_prompt_404_count = episode_counts["memory_prompt_404_count"]
    pr_404_count = episode_counts["pr_404_count"]
    fresh_capability_misses = int(memory_success_count > 0 or memory_404_count > 0) + int(pr_success_count > 0 or pr_404_count > 0)

    cache_file = Path(config_home) / "github-probe-cache.tsv"
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    existing_lines = load_probe_cache_lines(cache_file)
    preexisting_entries = [parse_probe_cache_line(line) for line in existing_lines]
    preexisting_entries = [entry for entry in preexisting_entries if entry]
    timestamp = isoformat(datetime.now(timezone.utc))

    if repo_identity:
        if memory_success_count > 0:
            record_probe_cache_kind(cache_file, existing_lines, repo_identity, "memory-enabled-success", session_id, timestamp)
        if pr_success_count > 0:
            record_probe_cache_kind(cache_file, existing_lines, repo_identity, "pr-lookup-success", session_id, timestamp)
        if memory_404_count > 0:
            record_probe_cache_kind(cache_file, existing_lines, repo_identity, "memory-enabled", session_id, timestamp)
        if memory_prompt_404_count > 0:
            record_probe_cache_kind(cache_file, existing_lines, repo_identity, "memory-prompt", session_id, timestamp)
        if pr_404_count > 0:
            record_probe_cache_kind(cache_file, existing_lines, repo_identity, "pr-lookup", session_id, timestamp)
        cache_file.write_text("\n".join(existing_lines) + ("\n" if existing_lines else ""), encoding="utf-8")

    cache_entries = [parse_probe_cache_line(line) for line in existing_lines]
    cache_entries = [entry for entry in cache_entries if entry]
    scoped_cache_kinds = ordered_unique(
        [
            entry["kind"]
            for entry in cache_entries
            if probe_cache_entry_matches_scope(entry, repo_identity, session_id)
        ]
    )
    preexisting_scoped_cache_kinds = ordered_unique(
        [
            entry["kind"]
            for entry in preexisting_entries
            if probe_cache_entry_matches_scope(entry, repo_identity, session_id)
        ]
    )

    memory_check = "unobserved"
    memory_check_cached = False
    if memory_success_count > 0 or memory_404_count > 0:
        memory_check = "checked_fresh"
    elif "memory-enabled" in scoped_cache_kinds:
        memory_check = "disabled_after_404"
        memory_check_cached = True
    elif "memory-enabled-success" in scoped_cache_kinds:
        memory_check = "reused_from_cache"
        memory_check_cached = True

    pr_context_check = "unobserved"
    pr_context_check_cached = False
    if pr_success_count > 0 or pr_404_count > 0:
        pr_context_check = "checked_fresh"
    elif "pr-lookup" in scoped_cache_kinds:
        pr_context_check = "disabled_after_404"
        pr_context_check_cached = True
    elif "pr-lookup-success" in scoped_cache_kinds:
        pr_context_check = "reused_from_cache"
        pr_context_check_cached = True

    explicit_missing_identity = bool(
        re.search(r"\bGitHub repository name is required\b|\brepository name is required\b", process_log, re.IGNORECASE)
    )
    local_repo_identity = bool(re.match(r"^local-repo-[a-f0-9]{12}$", repo_identity or "", re.IGNORECASE))
    unknown_repo_identity = not repo_identity or repo_identity == "unknown-repo"
    github_repo_identity_missing_observed = bool(explicit_missing_identity or local_repo_identity or unknown_repo_identity)
    github_repo_identity_source = (
        "process_log"
        if explicit_missing_identity
        else "local_repo_without_github_remote"
        if local_repo_identity
        else "unknown"
        if unknown_repo_identity
        else "not-observed"
    )

    return {
        "github_memory_enabled_check": memory_check,
        "github_memory_enabled_check_cached": memory_check_cached,
        "github_memory_enabled_check_count": memory_success_count + memory_404_count,
        "github_memory_enabled_success_count": memory_success_count,
        "pr_context_check": pr_context_check,
        "pr_context_check_cached": pr_context_check_cached,
        "pr_context_check_count": pr_success_count + pr_404_count,
        "github_pr_lookup_success_count": pr_success_count,
        "github_capability_cache_hits": int(memory_check_cached) + int(pr_context_check_cached),
        "github_capability_cache_misses": fresh_capability_misses,
        "github_repo_identity_missing_observed": github_repo_identity_missing_observed,
        "github_repo_identity_source": github_repo_identity_source,
        "github_memory_suppressed_for_missing_repo_identity": bool(
            github_repo_identity_missing_observed and memory_check in {"unobserved", "disabled_after_404"}
        ),
        "github_memory_enabled_fresh_after_cache_observed": "memory-enabled-success" in preexisting_scoped_cache_kinds and memory_success_count > 0,
        "pr_context_fresh_after_cache_observed": "pr-lookup-success" in preexisting_scoped_cache_kinds and pr_success_count > 0,
        "probe_cache_summary": scoped_cache_kinds,
    }


def summarize_github_repo_identity_signals(process_log, evidence_text, repo_identity, memory_check):
    explicit_missing_in_process_log = bool(
        re.search(r"\bGitHub repository name is required\b|\brepository name is required\b", process_log or "", re.IGNORECASE)
    )
    # User/assistant prose can quote this Copilot error text. Treat it as an
    # identity signal only from process/runtime logs; prompts should not disable
    # GitHub memory for a valid GitHub repo.
    explicit_missing_in_evidence = False
    repo_identity_value = (repo_identity or "").strip()
    local_repo_identity = bool(re.match(r"^local-repo-[a-f0-9]{12}$", repo_identity_value, re.IGNORECASE))
    unknown_repo_identity = repo_identity_value in {"", "unknown-repo"}
    github_repo_identity_missing_observed = (
        explicit_missing_in_process_log
        or explicit_missing_in_evidence
        or local_repo_identity
        or unknown_repo_identity
    )
    if explicit_missing_in_process_log:
        github_repo_identity_source = "process_log"
    elif explicit_missing_in_evidence:
        github_repo_identity_source = "stdout"
    elif local_repo_identity:
        github_repo_identity_source = "local_repo_without_github_remote"
    elif unknown_repo_identity:
        github_repo_identity_source = "unknown"
    else:
        github_repo_identity_source = "not-observed"

    github_memory_suppressed_for_missing_repo_identity = bool(
        github_repo_identity_missing_observed and memory_check in {"unobserved", "disabled_after_404"}
    )
    return {
        "github_repo_identity_missing_observed": github_repo_identity_missing_observed,
        "github_repo_identity_source": github_repo_identity_source,
        "github_memory_suppressed_for_missing_repo_identity": github_memory_suppressed_for_missing_repo_identity,
    }


def main():
    event_name = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = parse_payload(sys.stdin.read())
    session_id = payload.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        return

    transcript_path_value = payload.get("transcriptPath")
    transcript_path = Path(transcript_path_value) if isinstance(transcript_path_value, str) and transcript_path_value else None
    profile_home = (
        os.environ.get("XGC_COPILOT_PROFILE_HOME")
        or os.environ.get("COPILOT_HOME")
        or infer_profile_home_from_transcript(transcript_path)
        or os.path.join(os.path.expanduser("~"), ".copilot-xgc")
    )
    session_dir = transcript_path.parent if transcript_path else Path(profile_home) / "session-state" / session_id
    workspace_yaml = session_dir / "workspace.yaml"
    data = load_flat_yaml(workspace_yaml)

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else data.get("cwd")
    git_root = data.get("git_root") if isinstance(data.get("git_root"), str) else cwd
    repo_workspace_yaml = repo_owned_workspace_yaml_path(cwd, git_root)
    created_at = parse_iso(data.get("created_at"))
    payload_timestamp = iso_from_ms(payload.get("timestamp"))
    payload_timestamp_dt = parse_iso(payload_timestamp)
    current_head = git_head(git_root)
    stop_reason = payload.get("stopReason") if isinstance(payload.get("stopReason"), str) else None
    if event_name == "sessionStart":
        if isinstance(cwd, str) and cwd:
            data["cwd"] = cwd
        if isinstance(git_root, str) and git_root:
            data["git_root"] = git_root
        data.setdefault("id", session_id)
        if payload_timestamp and not data.get("created_at"):
            data["created_at"] = payload_timestamp
            created_at = payload_timestamp_dt
        if current_head and not data.get("session_start_head"):
            data["session_start_head"] = current_head
        if git_root and not data.get("session_start_git_status_files"):
            data["session_start_git_status_files"] = git_status_files(git_root)
        data["session_end_head"] = current_head
        data["session_head_changed"] = False
        data.setdefault("summary_finalization_status", "started")
        data.setdefault("final_status", "in_progress")
        data["updated_at"] = payload_timestamp or data.get("updated_at")
        session_dir.mkdir(parents=True, exist_ok=True)
        write_workspace_truth_snapshots(workspace_yaml, repo_workspace_yaml, data)
        return

    events = read_events_with_terminal_settle(
        transcript_path or (session_dir / "events.jsonl"),
        event_name,
        stop_reason,
    )
    terminal_finalization_event = is_session_terminal_finalization_event(event_name, stop_reason, events)
    shutdown_recovery_event = event_name == SESSION_SHUTDOWN_RECOVERY_EVENT
    shutdown_observed = event_type_seen(events, "session.shutdown")
    terminal_stop_hook_seen = terminal_stop_hook_observed(events)
    latest_event_dt = latest_event_timestamp(events)
    latest_known_dt = max([dt for dt in [latest_event_dt, payload_timestamp_dt] if dt is not None], default=None)
    previous_route_summary = data.get("route_summary") if isinstance(data.get("route_summary"), str) else None
    process_log_path, process_log_text = find_process_log(profile_home, session_id, transcript_path, cwd if isinstance(cwd, str) else "")
    hooks_log_path, raw_hooks_log_text = find_hooks_log(profile_home, cwd if isinstance(cwd, str) else "")
    hooks_log_text = filter_hooks_log_text_for_session(
        raw_hooks_log_text,
        session_id,
        created_at,
        latest_known_dt or payload_timestamp_dt,
    )
    events_text = collect_event_evidence_text(events)
    validation_events_text = collect_validation_evidence_text(events, "\n".join([process_log_text, hooks_log_text]).strip())
    scope_text = collect_scope_text(events)
    evidence_text = "\n".join(
        value
        for value in [
            data.get("summary") if isinstance(data.get("summary"), str) else "",
            scope_text,
            events_text,
            process_log_text,
            hooks_log_text,
        ]
        if value
    )

    route_summary = summarize_route(events, evidence_text, scope_text)
    repo_status_summary = classify_repo_status_files(git_status_files(git_root))
    repo_working_tree_files = list(repo_status_summary["repo_working_tree_files"])
    session_start_head = data.get("session_start_head") if isinstance(data.get("session_start_head"), str) else None
    session_start_head_source = data.get("session_start_head_source") if isinstance(data.get("session_start_head_source"), str) else None
    session_start_status_files = (
        [str(file_path) for file_path in data.get("session_start_git_status_files")]
        if isinstance(data.get("session_start_git_status_files"), list)
        else []
    )
    session_touched_repo_files = repo_write_paths_from_events(events, cwd, git_root)
    session_end_head = current_head
    if session_start_head and not session_start_head_source:
        session_start_head_source = "session-start-hook"
    if not session_start_head and created_at and session_end_head:
        recovered_start_head = git_head_before(git_root, created_at)
        if recovered_start_head:
            session_start_head = recovered_start_head
            session_start_head_source = "git-before-created-at"
    committed_repo_files = repo_code_files_from_paths(
        git_files_changed_between(git_root, session_start_head, session_end_head),
        cwd,
        git_root,
    )
    committed_diff_fallback_used = False
    committed_diff_source = "git-head-range" if session_start_head and session_end_head else "unavailable"
    if not committed_repo_files and not (session_start_head and session_end_head):
        committed_repo_files = repo_code_files_from_paths(git_files_committed_since(git_root, created_at), cwd, git_root)
        committed_diff_fallback_used = len(committed_repo_files) > 0
        if committed_repo_files:
            committed_diff_source = "git-log-since"
    if not committed_repo_files:
        shutdown_files = route_summary.get("session_shutdown_files_modified")
        if isinstance(shutdown_files, list) and shutdown_files:
            session_touched_repo_files = sorted(
                dict.fromkeys(session_touched_repo_files + repo_code_files_from_paths(shutdown_files, cwd, git_root))
            )
            committed_repo_files = repo_code_files_from_paths(
                [file_path for file_path in shutdown_files if isinstance(file_path, str) and file_path],
                cwd,
                git_root,
            )
            if committed_repo_files:
                committed_diff_fallback_used = True
                committed_diff_source = "session-shutdown-codeChanges"
    preexisting_working_tree_files = sorted(
        dict.fromkeys(
            file_path
            for file_path in repo_working_tree_files
            if file_path in session_start_status_files and file_path not in session_touched_repo_files
        )
    )
    if preexisting_working_tree_files:
        repo_working_tree_files = [
            file_path
            for file_path in repo_working_tree_files
            if file_path not in preexisting_working_tree_files
        ]
    session_state_files = repo_status_summary["session_state_files"]
    validation_threshold = created_at
    validation_artifact_files = list(repo_status_summary["validation_artifact_files"])
    if isinstance(cwd, str) and cwd:
        workspace_root = Path(cwd)
        session_state_files.extend(
            [f".xgc/{entry}" for entry in collect_relative_files(workspace_root / ".xgc", validation_threshold) if not entry.startswith("validation/") and not entry.startswith("live-smoke/")]
        )
        validation_artifact_files.extend(
            [f".xgc/validation/{entry}" for entry in collect_relative_files(workspace_root / ".xgc" / "validation", validation_threshold)]
        )
        validation_artifact_files.extend(
            [f".xgc/live-smoke/{entry}" for entry in collect_relative_files(workspace_root / ".xgc" / "live-smoke", validation_threshold)]
        )
        validation_artifact_files.extend(
            [f"test-results/{entry}" for entry in collect_relative_files(workspace_root / "test-results", validation_threshold)]
        )
        validation_artifact_files.extend(
            [f"playwright-report/{entry}" for entry in collect_relative_files(workspace_root / "playwright-report", validation_threshold)]
        )
    session_state_files.extend(collect_relative_files(session_dir))
    session_state_files = sorted(dict.fromkeys(session_state_files))
    validation_artifact_files = sorted(dict.fromkeys(validation_artifact_files))
    repo_code_files = sorted(dict.fromkeys(repo_working_tree_files + committed_repo_files))
    if repo_code_files and route_summary.get("patch_master_handoff_without_completion_observed"):
        route_summary["patch_master_handoff_without_completion_observed"] = False
    useful_session_state_files = useful_session_state_artifacts(session_state_files)
    integration_owned_surfaces_touched = classify_integration_owned_surfaces(repo_code_files)
    shared_surface_change_observed = len(integration_owned_surfaces_touched) > 0
    shared_surface_owner_declared = bool(
        re.search(r"\b(shared[-\s]surface|integration[-\s]owned surface) owner\s*:", evidence_text, re.IGNORECASE)
    )
    shared_surface_conflict_risk = shared_surface_change_observed and not shared_surface_owner_declared
    integration_signals = summarize_integration_class_signals(
        evidence_text,
        shared_surface_change_observed=shared_surface_change_observed,
    )
    foundation_failure_signals = summarize_foundation_failure_signals(validation_events_text)

    config_home = os.environ.get("XGC_COPILOT_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config", "xgc")
    repo_identity = data.get("repository") if isinstance(data.get("repository"), str) else None
    probe_summary = parse_process_log_summary(process_log_text, repo_identity, session_id, config_home)
    github_repo_identity_signals = summarize_github_repo_identity_signals(
        process_log_text,
        evidence_text,
        repo_identity,
        probe_summary.get("github_memory_enabled_check"),
    )
    retry_summary = summarize_provider_retries(process_log_text)
    validation_summary = merge_validation_summaries(
        summarize_validation_status(validation_events_text),
        summarize_validation_artifact_status(cwd, validation_artifact_files),
    )
    runtime_model_summary = summarize_runtime_models(events)
    agent_model_policy_mismatch_summary = summarize_agent_model_policy_mismatches(
        events,
        runtime_model_summary.get("requested_runtime_model"),
    )

    data["updated_at"] = isoformat(latest_known_dt) if latest_known_dt else data.get("updated_at")
    data["latest_event_at"] = isoformat(latest_event_dt) if latest_event_dt else data.get("latest_event_at")
    data["summary_route_heuristic_mismatch"] = bool(
        previous_route_summary and route_summary.get("route_summary") and previous_route_summary != route_summary.get("route_summary")
    )
    previous_route_agents = data.get("route_agents") if isinstance(data.get("route_agents"), list) else None
    data["summary_route_count_mismatch"] = bool(
        previous_route_agents
        and route_summary.get("route_agents")
        and len(previous_route_agents) != len(route_summary.get("route_agents"))
    )
    capability_count_keys = [
        "github_memory_enabled_check_count",
        "pr_context_check_count",
        "github_capability_cache_hits",
        "github_capability_cache_misses",
    ]
    data["summary_capability_count_mismatch"] = any(
        isinstance(data.get(key), int) and data.get(key) != probe_summary.get(key)
        for key in capability_count_keys
    )
    current_updated_at = parse_iso(data.get("updated_at"))
    data["summary_timestamp_stale"] = bool(latest_event_dt and current_updated_at and current_updated_at < latest_event_dt)
    if terminal_finalization_event:
        data["final_status"] = "completed" if stop_reason == "end_turn" else "stopped"
        if stop_reason:
            data["stop_reason"] = stop_reason
        data["summary_finalization_status"] = "finalized" if stop_reason == "end_turn" else "stopped"
    elif shutdown_recovery_event and shutdown_observed:
        data["final_status"] = "stopped"
        shutdown_type = route_summary.get("session_shutdown_type")
        if stop_reason and stop_reason != "end_turn":
            data["stop_reason"] = stop_reason
        else:
            data["stop_reason"] = f"session_shutdown_{shutdown_type}" if isinstance(shutdown_type, str) and shutdown_type else "session_shutdown"
        data["summary_finalization_status"] = "stopped"
    elif event_name == "errorOccurred":
        data["final_status"] = "error"
        data["summary_finalization_status"] = "error"
    else:
        data.setdefault("final_status", "in_progress")
        if data.get("summary_finalization_status") in {None, "started", "in_progress"}:
            data["summary_finalization_status"] = "partial"
    if not latest_event_dt and data.get("summary_finalization_status") == "partial":
        data["summary_finalization_status"] = "heuristic"
    data["finalization_complete"] = data.get("summary_finalization_status") == "finalized"
    data["finalization_partial"] = data.get("summary_finalization_status") in {"partial", "heuristic", "stopped"}
    data["finalization_error"] = data.get("summary_finalization_status") == "error"

    data.update(route_summary)
    data["terminal_stop_hook_observed"] = terminal_stop_hook_seen
    data["session_shutdown_recovery_finalized"] = bool(shutdown_recovery_event and shutdown_observed)
    data["route_summary_available"] = bool(route_summary.get("route_summary"))
    data["route_summary_derived_from_raw_events"] = bool(
        events
        and route_summary.get("route_summary_source")
        in {"started_with_fallbacks", "raw_tool_events_fallback", "session_shutdown_code_changes_fallback"}
    )
    data["route_summary_heuristic"] = bool(
        not events
        or route_summary.get("route_summary_source") != "started_with_fallbacks"
        or data.get("summary_finalization_status") == "heuristic"
    )
    data.update(integration_signals)
    data.update(foundation_failure_signals)
    data.update(validation_summary)
    apply_recovered_validation_foundation_truth(data)
    data["foundation_readiness_unknown"] = bool(
        data.get("foundation_readiness_unknown")
        or data.get("repeated_foundation_failure_observed")
        or data.get("validation_server_readiness_failure_observed")
        or data.get("preflight_blocker_observed")
    )
    data["foundation_risk_raised"] = bool(
        data.get("foundation_risk_raised")
        or data.get("repeated_foundation_failure_observed")
        or data.get("validation_server_readiness_failure_observed")
        or data.get("preflight_blocker_observed")
    )
    data.update(runtime_model_summary)
    data.update(agent_model_policy_mismatch_summary)
    data["agent_model_policy_mismatch_authority_downgrade"] = should_downgrade_authority_for_agent_model_policy(data)
    data.update(probe_summary)
    data.update(github_repo_identity_signals)
    data["session_start_head"] = session_start_head
    data["session_start_head_source"] = session_start_head_source
    data["session_end_head"] = session_end_head
    data["session_head_changed"] = bool(session_start_head and session_end_head and session_start_head != session_end_head)
    data["working_tree_clean"] = len(repo_working_tree_files) == 0
    data["repo_changes_committed"] = len(committed_repo_files) > 0
    data["repo_changes_uncommitted"] = len(repo_working_tree_files) > 0
    data["working_tree_only_diff_observed"] = len(repo_working_tree_files) > 0 and len(committed_repo_files) == 0
    if committed_diff_source == "unavailable" and repo_working_tree_files:
        committed_diff_source = "working-tree"
    data["committed_diff_source"] = committed_diff_source
    data["committed_diff_heuristic_observed"] = committed_diff_source in {
        "git-log-since",
        "session-shutdown-codeChanges",
    }
    data["repo_code_changed"] = len(repo_code_files) > 0
    data["committed_repo_changed"] = len(committed_repo_files) > 0
    data["repo_working_tree_changed"] = len(repo_working_tree_files) > 0
    data["session_state_only"] = len(repo_code_files) == 0 and len(session_state_files) > 0 and len(validation_artifact_files) == 0
    execution_handoff_without_observed_repo_diff = bool(
        route_summary.get("ownership_transferred_to_execution")
        and not repo_code_files
    )
    data["execution_handoff_without_observed_repo_diff"] = execution_handoff_without_observed_repo_diff
    data["execution_claim_without_observed_repo_diff"] = bool(
        (route_summary["patch_master_completed"] or route_summary.get("ownership_transferred_to_execution"))
        and not repo_code_files
    )
    non_terminal_completion_gap = bool(
        data.get("final_status") == "completed"
        and not data.get("session_shutdown_observed")
        and not repo_code_files
        and (
            data.get("planner_result_read_proxy_observed")
            or data.get("background_execution_agent_unresolved")
            or data.get("background_agent_unresolved_observed")
            or data.get("post_execution_completion_gap_observed")
            or data.get("patch_master_handoff_without_completion_observed")
            or (
                data.get("large_product_build_task_observed")
                and int(data.get("patch_master_invocation_count") or 0) <= 0
            )
        )
    )
    routine_shutdown_completion_gap = bool(
        data.get("final_status") == "completed"
        and data.get("routine_shutdown_during_open_turn_observed")
        and not repo_code_files
    )
    if non_terminal_completion_gap:
        data["final_status"] = "in_progress"
        data["summary_finalization_status"] = "partial"
        data["finalization_complete"] = False
        data["finalization_partial"] = True
        data["finalization_error"] = False
    elif routine_shutdown_completion_gap:
        data["final_status"] = "stopped"
        data["summary_finalization_status"] = "stopped"
        data["finalization_complete"] = False
        data["finalization_partial"] = True
        data["finalization_error"] = False
    data["committed_repo_files"] = committed_repo_files
    data["repo_working_tree_files"] = repo_working_tree_files
    data["preexisting_working_tree_files"] = preexisting_working_tree_files
    data["session_touched_repo_files"] = session_touched_repo_files
    data["session_state_files"] = session_state_files
    data["useful_session_state_files"] = useful_session_state_files
    data["validation_artifact_files"] = validation_artifact_files
    data["external_files"] = []
    data["integration_owned_surfaces_touched"] = integration_owned_surfaces_touched
    data["shared_surface_change_observed"] = shared_surface_change_observed
    data["shared_surface_owner_declared"] = shared_surface_owner_declared
    data["shared_surface_conflict_risk"] = shared_surface_conflict_risk
    data["shared_surface_review_recommended"] = shared_surface_change_observed
    data["shared_surface_final_integrator_needed"] = bool(
        shared_surface_change_observed
        and (data.get("integration_class_task_observed") or shared_surface_conflict_risk or data.get("patch_master_invocation_count", 0) > 1)
    )
    if process_log_path:
        data["process_log"] = str(process_log_path)
    data.update(retry_summary)
    user_abort_observed = event_type_seen(events, "abort")
    subagent_failure_observed = subagent_failure_seen(events)
    terminal_provider_failure_observed = retry_summary.get("provider_retry_state") == "terminal-failure-after-retry"
    data["user_abort_observed"] = bool(user_abort_observed)
    data["subagent_failure_observed"] = bool(subagent_failure_observed)
    data["terminal_provider_failure_observed"] = bool(terminal_provider_failure_observed)
    if user_abort_observed and not data["repo_code_changed"]:
        data["final_status"] = "stopped"
        data["summary_finalization_status"] = "stopped"
        data["finalization_complete"] = False
        data["finalization_partial"] = True
        data["finalization_error"] = False
    elif (subagent_failure_observed or terminal_provider_failure_observed) and not data["repo_code_changed"]:
        data["final_status"] = "error"
        data["summary_finalization_status"] = "error"
        data["finalization_complete"] = False
        data["finalization_partial"] = False
        data["finalization_error"] = True
    useful_validation_artifact_files = [
        file_path
        for file_path in validation_artifact_files
        if file_path not in {
            ".xgc/validation/events.jsonl",
            ".xgc/validation/workspace.yaml",
            "events.jsonl",
            "workspace.yaml",
        }
    ]
    data["useful_artifacts_observed"] = bool(data["repo_code_changed"] or useful_validation_artifact_files or useful_session_state_files)
    if not data.get("summary") and data["repo_code_changed"]:
        data["summary"] = "Direct Copilot session produced repo changes; see committed_repo_files and route_summary for recovered finalization truth."
        data["summary_count"] = 1
    session_outcome, session_outcome_detail = summarize_session_outcome(
        data.get("final_status"),
        data.get("summary_finalization_status"),
        data["repo_code_changed"],
        data["useful_artifacts_observed"],
        data.get("validation_status"),
        data.get("preflight_blocker_observed"),
        data.get("preflight_blocker_kind"),
        data.get("execution_handoff_without_observed_repo_diff"),
        data.get("background_execution_agent_unresolved"),
        data.get("background_agent_unresolved_observed"),
        data.get("patch_master_handoff_without_completion_observed"),
        data.get("post_execution_completion_gap_observed"),
        data.get("execution_owner_blocked_observed"),
        data.get("agent_model_policy_mismatch_authority_downgrade"),
        data.get("user_abort_observed"),
        data.get("subagent_failure_observed"),
        data.get("terminal_provider_failure_observed"),
        data.get("large_product_build_task_observed"),
        data.get("patch_master_invocation_count", 0),
        data.get("planner_result_read_proxy_observed"),
        data.get("specialist_fanout_status"),
    )
    data["session_outcome"] = session_outcome
    data["session_outcome_detail"] = session_outcome_detail
    summary_authority, summary_authority_reasons = summarize_summary_authority(
        event_name if (terminal_finalization_event or shutdown_recovery_event) else "",
        data.get("summary_finalization_status"),
        events,
        route_summary,
        latest_event_dt,
        process_log_path,
        session_start_head,
        session_end_head,
        committed_diff_fallback_used,
        data["repo_code_changed"],
        data["useful_artifacts_observed"],
        data.get("validation_status"),
        data.get("user_abort_observed"),
        data.get("subagent_failure_observed"),
        data.get("terminal_provider_failure_observed"),
    )
    data["summary_authority"] = summary_authority
    data["summary_authority_reasons"] = summary_authority_reasons
    if (
        data.get("large_product_build_task_observed")
        and not data.get("repo_code_changed")
        and int(data.get("patch_master_invocation_count") or 0) <= 0
    ):
        no_execution_reason = "large product request reached planning but no Patch Master execution owner was observed"
        if no_execution_reason not in (data.get("summary_authority_reasons") or []):
            data["summary_authority_reasons"] = list(data.get("summary_authority_reasons") or []) + [no_execution_reason]
        if data.get("summary_authority") == "authoritative":
            data["summary_authority"] = "finalized_with_gaps"
    if data.get("agent_model_policy_mismatch_observed") and data.get("agent_model_policy_mismatch_authority_downgrade"):
        data["summary_authority_reasons"] = list(data.get("summary_authority_reasons") or []) + [
            "observed agent model usage did not match resolved X for GitHub Copilot model policy"
        ]
        if data.get("summary_authority") == "authoritative":
            data["summary_authority"] = "finalized_with_gaps"
    archive_completeness, archive_completeness_reasons = summarize_archive_completeness(
        workspace_yaml,
        events,
        route_summary,
        process_log_path,
        data.get("summary_finalization_status"),
        validation_summary,
    )
    data["archive_completeness"] = archive_completeness
    data["archive_completeness_reasons"] = archive_completeness_reasons

    session_dir.mkdir(parents=True, exist_ok=True)
    write_workspace_truth_snapshots(workspace_yaml, repo_workspace_yaml, data)


if __name__ == "__main__":
    main()
