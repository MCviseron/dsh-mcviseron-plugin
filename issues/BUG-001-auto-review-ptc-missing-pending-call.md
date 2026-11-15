# BUG-001: [Auto review] — PTC inner tool call — Reviewer denies with "No pending tool call"

**Reporter:** MCviseron  
**Date:** 2026-11-10  
**Severity:** Medium  
**Reproducibility:** Often

---

## Summary

On DSH 0.2.2-rc.1 with the Auto permission preset, Auto review intermittently rejects PTC inner tool calls (tools invoked from inside `run_code`, for example `grep`, `read`, or `pwsh`) with the reason that no pending tool call was supplied. The reviewer appears to receive a history ending with a user instruction, so the actual pending action cannot be classified.

## Expected Behavior

Auto review should receive the pending PTC inner call as the final review item, classify that exact action, and return a normal allow/deny decision. If the action is allowed, the PTC tool call should execute without an unrelated "no pending tool call" rejection.

## Actual Behavior

The approval card shows an Auto review denial whose reason says the final item is a user instruction rather than the pending tool call. The inner call is not executed until the user manually selects **允许一次**.

The failure was observed for PTC calls with call IDs ending in `:ptc:1`; the outer `run_code` transport is excluded by design, but the inner call should still be reviewed.

## Reproduction Steps

**Prerequisites:** DSH Desktop `0.2.2-rc.1` (nightly), Auto review `0.2.2-rc.1`, the Auto permission preset selected, and a session with a long history (the observed sessions had roughly 1,000+ logged events).

1. Open a long-running session under the Auto permission preset.
2. Invoke a PTC inner tool through `run_code`, for example:
   ```ts
   const result = await tools.grep({ pattern: 'Auto review', path: 'D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin' });
   return result;
   ```
   or call `tools.read` / `tools.pwsh` the same way.
3. Observe the Auto review approval card.
4. Instead of reviewing the pending `grep`/`read`/`pwsh` call, the reviewer denies it with "No pending tool call was supplied to review; the final item is a user instruction".

### Minimal Reproduction (if applicable)

The smallest observed form is a PTC inner call under Auto review in a long session:

```ts
// executed as the body of run_code
const result = await tools.grep({ pattern: 'anything', path: 'D:/some/project' });
return result;
```

The same failure was observed with `tools.read` and `tools.pwsh`. A manual **允许一次** lets the call run, so the underlying tool itself is reachable.

## Environment

| Detail | Value |
|--------|-------|
| **DSH Desktop** | `0.2.2-rc.1` (nightly) |
| **Auto review package** | `@deepseek-ai/dsh-experimental-auto-review` `0.2.2-rc.1` |
| **Plugin environment** | `dsh-mcviseron-plugin` `0.7.2` (its Auto review integration only appends a Chinese display translation) |
| **Permission preset** | Auto (Auto review enabled) |
| **Agent / Client** | DSH Desktop (Windows) |
| **OS** | Windows 11 Home China, 10.0.26200, x64 |
| **Architecture** | x64 |

## Error Output

Exact approval reason observed at 2026-11-10T11:32:09.346Z:

```text
Auto review denied tool "grep": No pending tool call was supplied to review; the final item is a user instruction, so the action’s actual effects cannot be classified.

【审查理由 · 中文翻译】
未提供待审查的待处理工具调用；最后一项是用户指令，因此该操作的实际效果无法分类。
```

Other exact reasons observed in the same session:

```text
Auto review denied tool "grep": no pending tool call provided
```

```text
Auto review denied tool "grep": No pending tool call was supplied to review; the final item is a user instruction, so the action’s actual effects cannot be classified.
```

Relevant approval events:

```text
2026-11-10T05:52:10.783Z  tool=grep  callId=call_00_DaRmtLzbo4MQA3V4G3Sd2137:ptc:1  reason="no pending tool call provided"
2026-11-10T10:50:19.396Z  tool=grep  callId=call_00_VyEgdP8SAUZlKNhjswkg7705:ptc:1  reason="pending tool call is not identifiable from the provided history; fail closed on ambiguous action"
2026-11-10T11:32:09.346Z  tool=grep  callId=call_00_rHbjiTaY1BHDw4S8BohD4886:ptc:1  reason="No pending tool call was supplied to review; the final item is a user instruction..."
```

## Visual Evidence

The supplied screenshot shows the approval card titled **等待审批** with the exact English denial reason above and the plugin-appended Chinese translation block. It has no tool-specific action details because the reviewer denied before classifying the action; the call is only recoverable through **允许一次**.

## Impact

- **Scope:** Sessions using the Auto permission preset and PTC inner tools through `run_code`; observed in long sessions.
- **Workaround:** Select **允许一次** on the approval card, or temporarily switch the session away from Auto review. Native top-level calls were not observed to fail in the same way.
- **Blocking:** Yes for unattended Auto-mode work: every affected inner tool call stops for manual approval even when the action is ordinary and low risk.

## Related Files

| File | Relevance |
|------|-----------|
| `D:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-experimental-auto-review/lib/index.js` | Official Auto review implementation: `snapshotAutoReview`, `reviewMessages`, and PTC branch that should append the pending call. |
| `D:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/**` | PTC dispatch and inner-call identity (`...:ptc:N`). |
| `D:/Program/DSH-Plugin-Class/dsh-mcviseron-plugin/src/components/auto-review-fix/review-context.ts` | Plugin-side review context adapter. It only matches the older single-message `FILTERED_HISTORY`/`PENDING_ACTION` shape and does not modify the 0.2.2 multi-message review request; included for investigator context, not as an asserted cause. |

## Notes

- All observed failures were on **PTC inner calls** (call IDs ending `...:ptc:1`), not on the outer `run_code` call. The reviewer message says the final item is a user instruction, which suggests the pending PTC entry is absent from the reviewer's message list, but this is **speculation**, not a confirmed root cause.
- The failure is intermittent: the same session also had PTC calls that were reviewed and executed, and manual **允许一次** always worked.
- The plugin's `auto-review-fix` integration adds the Chinese translation block to the approval display; it does not alter the review decision. Its review-context guard produced no `review context trimmed` entry for this new-format request.
- No secrets or credentials are included in this report.
