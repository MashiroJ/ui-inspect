export function compactFrontendRequestResult(result: any): any {
  if (!result || !result.ok) {
    return result;
  }

  const compact: Record<string, unknown> = {
    ok: result.ok,
    timedOut: result.timedOut ?? false,
    requestId: result.requestId,
    nextCursor: result.nextCursor,
    message: result.message,
    session: result.session,
    selection: result.selection,
    targetCount: result.targetCount,
    contextSummary: result.contextSummary,
    elementSnapshotSummary: result.elementSnapshotSummary,
    domSearchHints: result.domSearchHints,
    targetsSummary: result.targetsSummary,
    sourceHintSummary: result.sourceHintSummary,
    runtimeSummary: result.runtimeSummary,
  };

  if (result.source) {
    const { content, ...sourceRest } = result.source;
    compact.source = sourceRest;
  }

  if (result.diagnostics) {
    compact.diagnosticsSummary = summarizeDiagnostics(result.diagnostics);
  }

  return compact;
}

function summarizeDiagnostics(diagnostics: any): string {
  if (!diagnostics) return '';
  const parts: string[] = [];
  if (diagnostics.runtimeEvents != null) {
    parts.push(`runtimeEvents=${diagnostics.runtimeEvents.length ?? 0}`);
  }
  if (diagnostics.truncated != null) {
    parts.push(`truncated=${diagnostics.truncated}`);
  }
  return parts.join(', ');
}
