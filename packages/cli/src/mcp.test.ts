import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UiInspectSelection, UiInspectSession } from '@ui-inspect/protocol';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getMcpToolDefinition, latestFrontendRequest, normalizeCompleteFrontendRequestArgs, resolveProjectRoot, compactFrontendRequestResult, waitForFrontendRequest } from './mcp.js';
import { startUiInspectHandler } from './mcp/handlers/start.js';
import { getVersion } from './version.js';

describe('complete_frontend_request tool', () => {
  it('exposes the required completion-and-wait schema', () => {
    const tool = getMcpToolDefinition('complete_frontend_request') as {
      inputSchema?: unknown;
    } | undefined;
    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    } | undefined;

    expect(tool).toBeTruthy();
    expect(schema?.required).toEqual(['sessionId', 'content', 'afterRequestId']);
    expect(Object.keys(schema?.properties || {})).toEqual(expect.arrayContaining([
      'sessionId',
      'content',
      'afterRequestId',
      'status',
      'timeoutMs',
      'context',
      'sinceTimestamp',
      'responseMode',
    ]));
  });

  it('defaults completion status to done', () => {
    const result = normalizeCompleteFrontendRequestArgs({
      sessionId: ' session-1 ',
      content: ' finished ',
      afterRequestId: ' message:msg-1 ',
    }, 100_000);

    expect(result).toEqual({
      sessionId: 'session-1',
      content: 'finished',
      afterRequestId: 'message:msg-1',
      status: 'done',
      context: 80,
      timeoutMs: 600_000,
      sinceTimestamp: 70_000,
      responseMode: 'compact',
    });
  });

  it('accepts failed as a completion status', () => {
    const result = normalizeCompleteFrontendRequestArgs({
      sessionId: 'session-1',
      content: 'could not apply safely',
      afterRequestId: 'selection:sel-1',
      status: 'failed',
    }, 100_000);

    expect(result.status).toBe('failed');
  });

  it('requires afterRequestId to avoid replaying the same request', () => {
    expect(() => normalizeCompleteFrontendRequestArgs({
      sessionId: 'session-1',
      content: 'finished',
    }, 100_000)).toThrow('afterRequestId is required');
  });

  it('rejects non-terminal completion statuses', () => {
    expect(() => normalizeCompleteFrontendRequestArgs({
      sessionId: 'session-1',
      content: 'finished',
      afterRequestId: 'message:msg-1',
      status: 'working',
    }, 100_000)).toThrow('status must be done or failed');
  });
});

describe('start_ui_inspect tool', () => {
  it('ensures the daemon and returns project integration status', async () => {
    const project = mkdtempSync(join(tmpdir(), 'ui-inspect-mcp-start-test-'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'plain-project', version: '0.0.0' }, null, 2));
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, name: 'ui-inspect', version: getVersion() }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      const result = await startUiInspectHandler(
        { project },
        `http://127.0.0.1:${address.port}`,
      ) as { ok: boolean; projectRoot: string; integration: { projectType: string; missing: string[] } };

      expect(result.ok).toBe(true);
      expect(result.projectRoot).toBe(project);
      expect(result.integration.projectType).toBe('unknown');
      expect(result.integration.missing).toEqual(['project-integration']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('waitForFrontendRequest flow', () => {
  it('polls daemon sessions, claims the task, and returns a compact request', async () => {
    const selection = makeSelection({
      source: { root: '/project', file: null, line: null, column: null },
      dom: {
        selector: 'div#app > div.wrong-question-page > div.explain-content',
        tagName: 'div',
        id: '',
        className: 'explain-content el-table__cell',
        text: '错因解释',
        outerHtml: '<div class="explain-content">错因解释</div>',
        rect: { x: 800, y: 276, width: 691, height: 353 },
        styles: { color: 'rgb(144, 147, 153)', fontSize: '14px', display: 'block', position: 'static' },
      },
      context: {
        attributes: { class: 'explain-content el-table__cell', 'data-v-f2081870': '' },
        parentChain: [{
          tagName: 'div',
          selector: 'div.wrong-question-page',
          attributes: { class: 'wrong-question-page zvue-main' },
        }],
      },
    });
    const session = makeSession({ selection, targets: [{ id: selection.id, note: 'make it clearer', selection }] });
    const seenStatuses: string[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/sessions') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ sessions: [session] }));
        return;
      }
      if (req.method === 'POST' && req.url === `/sessions/${session.id}/status`) {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          seenStatuses.push(JSON.parse(body).status);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ session: { ...session, status: 'claimed' } }));
        });
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      const result = await waitForFrontendRequest(
        { sinceTimestamp: 1000, timeoutMs: 1000, responseMode: 'compact' },
        `http://127.0.0.1:${address.port}`,
        undefined,
      );

      expect(result.ok).toBe(true);
      expect(result.requestId).toBe('selection:selection-1');
      expect(result.nextCursor).toEqual({ afterRequestId: 'selection:selection-1' });
      expect(result.targetsSummary).toContain('make it clearer');
      expect(result.elementSnapshotSummary).toContain('ELEMENT\n<div class="explain-content el-table__cell">');
      expect(result.elementSnapshotSummary).toContain('PATH\ndiv#app > div.wrong-question-page > div.explain-content');
      expect(result.elementSnapshotSummary).toContain('HTML\n<div class="explain-content">错因解释</div>');
      expect(result.domSearchHints).toEqual(expect.arrayContaining([
        expect.objectContaining({ token: 'explain-content', reason: 'selected element class', priority: 'high' }),
        expect.objectContaining({ token: 'wrong-question-page', reason: 'ancestor class from DOM path', priority: 'medium' }),
      ]));
      expect(result.domSearchHints.some((hint: { token: string }) => hint.token === 'el-table__cell')).toBe(false);
      expect(result.domSearchHints.some((hint: { token: string }) => hint.token === 'zvue-main')).toBe(false);
      expect(result.source).toBeUndefined();
      expect(seenStatuses).toEqual(['claimed']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('latestFrontendRequest', () => {
  it('returns a user message request when one exists', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'make it wider',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.session.id).toBe('session-1');
    expect(result?.message.content).toBe('make it wider');
    expect(result?.requestId).toBe('message:msg-1');
  });

  it('treats a sent selection without a user message as a frontend request', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [],
      selection: makeSelection({ instruction: '' }),
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.session.id).toBe('session-1');
    expect(result?.message.content).toBe('Browser selection sent without additional user text.');
    expect(result?.message.selectionId).toBe('selection-1');
    expect(result?.requestId).toBe('selection:selection-1');
  });

  it('uses target notes for a message-free batch request', () => {
    const selection = makeSelection({ instruction: '' });
    const session = makeSession({
      updatedAt: 3000,
      messages: [],
      selection,
      targets: [{
        id: 'target-1',
        note: 'make this compact',
        selection,
      }],
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.message.content).toContain('Target notes:');
    expect(result?.message.content).toContain('make this compact');
    expect(result?.requestId).toBe('selection:selection-1');
  });

  it('ignores stale selections', () => {
    const session = makeSession({
      updatedAt: 500,
      messages: [],
      selection: makeSelection({ timestamp: 500 }),
    });

    expect(latestFrontendRequest({ sessions: [session] }, 1000)).toBeNull();
  });

  it('returns requestId with message: prefix for real user messages', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-42',
        sessionId: 'session-1',
        role: 'user',
        content: 'change the color',
        timestamp: 2500,
        selectionId: 'selection-1',
      }],
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.requestId).toBe('message:msg-42');
    expect(result?.nextCursor).toBeUndefined();
  });

  it('returns requestId with selection: prefix for sent selection without message', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [],
      selection: makeSelection({ id: 'sel-abc', instruction: '' }),
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.requestId).toBe('selection:sel-abc');
  });

  it('skips already-seen request when afterRequestId matches', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'make it wider',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
    });

    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-1',
    );

    expect(result).toBeNull();
  });

  it('returns newer request after cursor with afterRequestId', () => {
    const session = makeSession({
      updatedAt: 4000,
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'first task',
          timestamp: 2000,
          selectionId: 'selection-1',
        },
        {
          id: 'msg-2',
          sessionId: 'session-1',
          role: 'user',
          content: 'second task',
          timestamp: 3500,
          selectionId: 'selection-1',
        },
      ],
    });

    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-1',
    );

    expect(result?.requestId).toBe('message:msg-2');
    expect(result?.message.content).toBe('second task');
  });

  it('does not return same selection request when afterRequestId matches it', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [],
      selection: makeSelection({ id: 'sel-x', instruction: '' }),
    });

    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'selection:sel-x',
    );

    expect(result).toBeNull();
  });

  it('returns new selection request after cursor on same session', () => {
    const session1 = makeSession({
      id: 'session-1',
      updatedAt: 2000,
      messages: [],
      selection: makeSelection({ id: 'sel-1', sessionId: 'session-1', instruction: '', timestamp: 2000 }),
    });
    const session2 = makeSession({
      id: 'session-2',
      updatedAt: 4000,
      messages: [],
      selection: makeSelection({ id: 'sel-2', sessionId: 'session-2', instruction: '', timestamp: 4000 }),
    });

    const result = latestFrontendRequest(
      { sessions: [session1, session2] },
      1000,
      'selection:sel-1',
    );

    expect(result?.requestId).toBe('selection:sel-2');
    expect(result?.session.id).toBe('session-2');
  });

  it('returns new selection in same session when current selection has no matching user message', () => {
    const session = makeSession({
      updatedAt: 4000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'first task',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
      selection: makeSelection({ id: 'selection-2', instruction: '', timestamp: 4000 }),
    });

    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-1',
    );

    expect(result?.requestId).toBe('selection:selection-2');
    expect(result?.session.id).toBe('session-1');
  });

  it('skips selection when its id already has a matching user message', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'task for this selection',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
      selection: makeSelection({ id: 'selection-1', instruction: 'task for this selection', timestamp: 2000 }),
    });

    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-1',
    );

    expect(result).toBeNull();
  });

  it('returns requests in chronological order across sessions', () => {
    const sessionA = makeSession({
      id: 'session-a',
      updatedAt: 2000,
      messages: [],
      selection: makeSelection({ id: 'sel-a', sessionId: 'session-a', instruction: '', timestamp: 2000 }),
    });
    const sessionB = makeSession({
      id: 'session-b',
      updatedAt: 4000,
      messages: [{
        id: 'msg-b1',
        sessionId: 'session-b',
        role: 'user',
        content: 'task b',
        timestamp: 4000,
        selectionId: 'sel-b',
      }],
      selection: makeSelection({ id: 'sel-b', sessionId: 'session-b', timestamp: 4000 }),
    });
    const sessionC = makeSession({
      id: 'session-c',
      updatedAt: 6000,
      messages: [],
      selection: makeSelection({ id: 'sel-c', sessionId: 'session-c', instruction: '', timestamp: 6000 }),
    });

    const first = latestFrontendRequest({ sessions: [sessionA, sessionB, sessionC] }, 1000);
    expect(first?.requestId).toBe('selection:sel-a');

    const second = latestFrontendRequest(
      { sessions: [sessionA, sessionB, sessionC] },
      1000,
      first!.requestId,
    );
    expect(second?.requestId).toBe('message:msg-b1');

    const third = latestFrontendRequest(
      { sessions: [sessionA, sessionB, sessionC] },
      1000,
      second!.requestId,
    );
    expect(third?.requestId).toBe('selection:sel-c');

    const fourth = latestFrontendRequest(
      { sessions: [sessionA, sessionB, sessionC] },
      1000,
      third!.requestId,
    );
    expect(fourth).toBeNull();
  });

  it('ignores claimed, working, done, and failed sessions without user messages', () => {
    for (const status of ['claimed', 'working', 'done', 'failed'] as const) {
      const session = makeSession({
        updatedAt: 3000,
        status,
        messages: [],
        selection: makeSelection({ instruction: '' }),
      });

      expect(latestFrontendRequest({ sessions: [session] }, 1000)).toBeNull();
    }
  });

  it('ignores assistant replies as request candidates', () => {
    const session = makeSession({
      updatedAt: 4000,
      messages: [
        {
          id: 'msg-user-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'do something',
          timestamp: 2000,
          selectionId: 'selection-1',
        },
        {
          id: 'msg-assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'done!',
          timestamp: 3000,
          selectionId: 'selection-1',
        },
      ],
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);
    expect(result?.requestId).toBe('message:msg-user-1');
  });

  it('still works with sinceTimestamp when no afterRequestId is given', () => {
    const session = makeSession({
      updatedAt: 3000,
      status: 'done',
      messages: [{
        id: 'msg-old',
        sessionId: 'session-1',
        role: 'user',
        content: 'old task',
        timestamp: 500,
        selectionId: 'selection-1',
      }],
    });

    expect(latestFrontendRequest({ sessions: [session] }, 1000)).toBeNull();
  });

  it('prefers afterRequestId cursor over sinceTimestamp', () => {
    const session = makeSession({
      updatedAt: 4000,
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'old',
          timestamp: 500,
          selectionId: 'selection-1',
        },
        {
          id: 'msg-2',
          sessionId: 'session-1',
          role: 'user',
          content: 'new',
          timestamp: 3500,
          selectionId: 'selection-1',
        },
      ],
    });

    // sinceTimestamp would exclude msg-1, but afterRequestId=msg-1 should include msg-2
    const result = latestFrontendRequest(
      { sessions: [session] },
      3000,
      'message:msg-1',
    );

    expect(result?.requestId).toBe('message:msg-2');
  });

  it('falls back to sinceTimestamp for unknown afterRequestId cursor', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'task',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
    });

    // Unknown cursor falls back to sinceTimestamp, so msg-1 at 2000 is excluded by sinceTimestamp=3000
    const result = latestFrontendRequest(
      { sessions: [session] },
      3000,
      'message:unknown-msg',
    );

    expect(result).toBeNull();
  });

  it('returns candidates after sinceTimestamp when cursor is unknown but sinceTimestamp allows them', () => {
    const session = makeSession({
      updatedAt: 3000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'task',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
    });

    // Unknown cursor falls back to sinceTimestamp=1000, so msg-1 at 2000 passes
    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:unknown-msg',
    );

    expect(result?.requestId).toBe('message:msg-1');
  });

  it('returns second request when two requests share the same timestamp', () => {
    const session = makeSession({
      updatedAt: 2000,
      messages: [
        {
          id: 'msg-a',
          sessionId: 'session-1',
          role: 'user',
          content: 'first',
          timestamp: 2000,
          selectionId: 'selection-1',
        },
        {
          id: 'msg-b',
          sessionId: 'session-1',
          role: 'user',
          content: 'second',
          timestamp: 2000,
          selectionId: 'selection-1',
        },
      ],
    });

    const first = latestFrontendRequest({ sessions: [session] }, 1000);
    expect(first?.requestId).toBe('message:msg-a');

    const second = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-a',
    );
    expect(second?.requestId).toBe('message:msg-b');

    const third = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-b',
    );
    expect(third).toBeNull();
  });

  it('returns selection after message at same timestamp', () => {
    const session = makeSession({
      id: 'session-1',
      updatedAt: 2000,
      messages: [{
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'task',
        timestamp: 2000,
        selectionId: 'selection-1',
      }],
      selection: makeSelection({ id: 'selection-1', sessionId: 'session-1', instruction: 'task', timestamp: 2000 }),
    });

    // selection-1 has a matching user message, so it's not a candidate.
    // After msg-1, nothing remains.
    const result = latestFrontendRequest(
      { sessions: [session] },
      1000,
      'message:msg-1',
    );
    expect(result).toBeNull();
  });

  it('generates synthetic message for target notes as user request', () => {
    const selection = makeSelection({ instruction: '' });
    const session = makeSession({
      updatedAt: 3000,
      messages: [],
      selection,
      targets: [
        { id: 't-1', note: 'resize this', selection },
        { id: 't-2', note: 'move that', selection },
      ],
    });

    const result = latestFrontendRequest({ sessions: [session] }, 1000);

    expect(result?.requestId).toBe('selection:selection-1');
    expect(result?.message.content).toContain('resize this');
    expect(result?.message.content).toContain('move that');
  });
});

describe('resolveProjectRoot', () => {
  it('prefers explicit project input', () => {
    expect(resolveProjectRoot('/tmp/app', {}, '/')).toBe('/tmp/app');
  });

  it('trims explicit project input', () => {
    expect(resolveProjectRoot('  /tmp/app  ', {}, '/')).toBe('/tmp/app');
  });

  it('ignores non-string input', () => {
    expect(resolveProjectRoot(undefined, {}, '/fallback')).toBe('/fallback');
    expect(resolveProjectRoot(42, {}, '/fallback')).toBe('/fallback');
  });

  it('uses WORKSPACE_FOLDER_PATHS when no explicit project', () => {
    const env = { WORKSPACE_FOLDER_PATHS: '/tmp/app' };
    expect(resolveProjectRoot(undefined, env, '/fallback')).toBe('/tmp/app');
  });

  it('splits WORKSPACE_FOLDER_PATHS by comma', () => {
    const env = { WORKSPACE_FOLDER_PATHS: '/tmp/a,/tmp/b' };
    expect(resolveProjectRoot(undefined, env, '/fallback')).toBe('/tmp/a');
  });

  it('splits WORKSPACE_FOLDER_PATHS by newline', () => {
    const env = { WORKSPACE_FOLDER_PATHS: '/tmp/a\n/tmp/b' };
    expect(resolveProjectRoot(undefined, env, '/fallback')).toBe('/tmp/a');
  });

  it('splits WORKSPACE_FOLDER_PATHS by system path delimiter', () => {
    const env = { WORKSPACE_FOLDER_PATHS: '/tmp/a:/tmp/b' };
    expect(resolveProjectRoot(undefined, env, '/fallback', ':')).toBe('/tmp/a');
  });

  it('splits WORKSPACE_FOLDER_PATHS by semicolon for Windows-style delimiter', () => {
    const env = { WORKSPACE_FOLDER_PATHS: 'C:\\a;C:\\b' };
    expect(resolveProjectRoot(undefined, env, '/fallback', ';')).toBe('C:\\a');
  });

  it('trims WORKSPACE_FOLDER_PATHS entries', () => {
    const env = { WORKSPACE_FOLDER_PATHS: '  /tmp/a , /tmp/b  ' };
    expect(resolveProjectRoot(undefined, env, '/fallback')).toBe('/tmp/a');
  });

  it('skips empty WORKSPACE_FOLDER_PATHS entries', () => {
    const env = { WORKSPACE_FOLDER_PATHS: ',/tmp/b,' };
    expect(resolveProjectRoot(undefined, env, '/fallback')).toBe('/tmp/b');
  });

  it('falls back to cwd when no env and no input', () => {
    expect(resolveProjectRoot(undefined, {}, '/cwd')).toBe('/cwd');
  });

  it('picks first workspace with package.json over one without', async () => {
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const tmp = `/tmp/ui-inspect-test-${Date.now()}`;
    const noPackage = `${tmp}/no-package`;
    const withPackage = `${tmp}/with-package`;
    try {
      await mkdir(noPackage, { recursive: true });
      await mkdir(withPackage, { recursive: true });
      await writeFile(`${withPackage}/package.json`, '{}');

      const env = { WORKSPACE_FOLDER_PATHS: `${noPackage}:${withPackage}` };
      expect(resolveProjectRoot(undefined, env, '/fallback', ':')).toBe(withPackage);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns first workspace when none have package.json', async () => {
    const { mkdir, rm } = await import('node:fs/promises');
    const tmp = `/tmp/ui-inspect-test-${Date.now()}`;
    const a = `${tmp}/a`;
    const b = `${tmp}/b`;
    try {
      await mkdir(a, { recursive: true });
      await mkdir(b, { recursive: true });

      const env = { WORKSPACE_FOLDER_PATHS: `${a}:${b}` };
      expect(resolveProjectRoot(undefined, env, '/fallback', ':')).toBe(a);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('wait_for_frontend_request schema', () => {
  it('includes responseMode property', () => {
    const tool = getMcpToolDefinition('wait_for_frontend_request') as {
      inputSchema?: unknown;
    } | undefined;
    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
    } | undefined;
    expect(schema?.properties).toHaveProperty('responseMode');
    const responseMode = schema?.properties?.responseMode as { type: string; enum: string[] };
    expect(responseMode.type).toBe('string');
    expect(responseMode.enum).toEqual(['compact', 'full']);
  });
});

describe('complete_frontend_request schema', () => {
  it('includes responseMode property', () => {
    const tool = getMcpToolDefinition('complete_frontend_request') as {
      inputSchema?: unknown;
    } | undefined;
    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
    } | undefined;
    expect(schema?.properties).toHaveProperty('responseMode');
    const responseMode = schema?.properties?.responseMode as { type: string; enum: string[] };
    expect(responseMode.type).toBe('string');
    expect(responseMode.enum).toEqual(['compact', 'full']);
  });
});

describe('compactFrontendRequestResult', () => {
  it('strips source.content from the result', () => {
    const result = {
      ok: true,
      timedOut: false,
      requestId: 'message:msg-1',
      nextCursor: { afterRequestId: 'message:msg-1' },
      message: { id: 'msg-1', content: 'test', role: 'user' },
      session: { id: 'session-1', status: 'claimed', mode: 'single', createdAt: 1000, updatedAt: 2000 },
      selection: {
        id: 'sel-1',
        framework: 'dom',
        tagName: 'div',
        selector: '#app',
        text: 'hello',
        componentName: null,
        sourceFile: 'src/App.vue',
        sourceLine: null,
      },
      targetCount: 0,
      source: { file: 'src/App.vue', root: '/project', startLine: 1, endLine: 10, totalLines: 50, content: 'source code line 1\nsource code line 2' },
      contextSummary: 'Element: div#app',
      targetsSummary: 'No targets.',
      sourceHintSummary: 'No source hints.',
      runtimeSummary: 'No user-confirmed runtime diagnostics.',
    };

    const compact = compactFrontendRequestResult(result) as Record<string, unknown>;

    expect(compact.ok).toBe(true);
    expect(compact.requestId).toBe('message:msg-1');
    expect(compact.nextCursor).toEqual({ afterRequestId: 'message:msg-1' });
    const source = compact.source as Record<string, unknown>;
    expect(source).not.toHaveProperty('content');
    expect(source).toHaveProperty('file');
    expect(source).toHaveProperty('root');
    expect(source).toHaveProperty('startLine');
    expect(source).toHaveProperty('endLine');
    expect(source).toHaveProperty('totalLines');
    expect(compact.targetSources).toBeUndefined();
    expect(compact.targets).toBeUndefined();
    expect(compact.diagnostics).toBeUndefined();
  });

  it('preserves key fields in compact result', () => {
    const result = {
      ok: true,
      timedOut: false,
      requestId: 'message:msg-1',
      nextCursor: { afterRequestId: 'message:msg-1' },
      message: { id: 'msg-1', content: 'make it wider', role: 'user' },
      session: { id: 'session-1', status: 'claimed', mode: 'single', createdAt: 1000, updatedAt: 2000 },
      selection: {
        id: 'sel-1',
        framework: 'vue',
        tagName: 'div',
        selector: '#app',
        text: 'hello',
        componentName: 'App',
        sourceFile: 'src/App.vue',
        sourceLine: 42,
        component: { framework: 'vue', name: 'App', hierarchy: [] },
        source: { file: 'src/App.vue', line: 42 },
      },
      targetCount: 2,
      source: { file: 'src/App.vue', root: '/project', startLine: 40, endLine: 50, totalLines: 100, content: 'big source' },
      contextSummary: 'Element: App · div#app · hello',
      elementSnapshotSummary: 'ELEMENT\n<div id="app">',
      domSearchHints: [{ token: 'app-shell', reason: 'selected element class', priority: 'high', suggestedSearch: 'app-shell' }],
      targetsSummary: '1. target1\n2. target2',
      sourceHintSummary: 'hint1',
      runtimeSummary: 'runtime diag',
    };

    const compact = compactFrontendRequestResult(result) as Record<string, unknown>;

    expect(compact.ok).toBe(true);
    expect(compact.requestId).toBe('message:msg-1');
    expect(compact.nextCursor).toEqual({ afterRequestId: 'message:msg-1' });
    expect((compact.message as Record<string, unknown>).content).toBe('make it wider');
    expect((compact.session as Record<string, unknown>).id).toBe('session-1');
    const sel = compact.selection as Record<string, unknown>;
    expect(sel.componentName).toBe('App');
    expect(sel.sourceFile).toBe('src/App.vue');
    expect(compact.targetCount).toBe(2);
    expect(compact.contextSummary).toBe('Element: App · div#app · hello');
    expect(compact.elementSnapshotSummary).toBe('ELEMENT\n<div id="app">');
    expect(compact.domSearchHints).toEqual([
      { token: 'app-shell', reason: 'selected element class', priority: 'high', suggestedSearch: 'app-shell' },
    ]);
    expect(compact.targetsSummary).toBe('1. target1\n2. target2');
  });

  it('passes through timed-out results unchanged', () => {
    const result = {
      ok: false,
      timedOut: true,
      timeoutMs: 600000,
      message: 'No browser request was sent within 600 seconds.',
    };

    const compact = compactFrontendRequestResult(result);
    expect(compact).toEqual(result);
  });

  it('does not include batchContext, targets, targetSources, or diagnostics in compact', () => {
    const result = {
      ok: true,
      timedOut: false,
      requestId: 'message:msg-1',
      nextCursor: { afterRequestId: 'message:msg-1' },
      message: { id: 'msg-1', content: 'test', role: 'user' },
      session: { id: 'session-1', status: 'claimed', mode: 'single', createdAt: 1000, updatedAt: 2000 },
      selection: null,
      targetCount: 0,
      targets: [{ id: 't-1', note: 'test', selection: {} }],
      source: null,
      targetSources: [{ id: 't-1', source: { content: 'code' } }],
      batchContext: { targetCount: 1 },
      contextSummary: '',
      targetsSummary: '',
      sourceHintSummary: '',
      runtimeSummary: '',
      diagnostics: { runtimeEvents: [{ message: 'err' }] },
    };

    const compact = compactFrontendRequestResult(result) as Record<string, unknown>;

    expect(compact.targets).toBeUndefined();
    expect(compact.targetSources).toBeUndefined();
    expect(compact.batchContext).toBeUndefined();
    expect(compact.diagnostics).toBeUndefined();
  });

  it('includes diagnosticsSummary when diagnostics are present', () => {
    const result = {
      ok: true,
      timedOut: false,
      requestId: 'message:msg-1',
      nextCursor: { afterRequestId: 'message:msg-1' },
      message: { id: 'msg-1', content: 'test', role: 'user' },
      session: { id: 'session-1', status: 'claimed', mode: 'single', createdAt: 1000, updatedAt: 2000 },
      selection: null,
      targetCount: 0,
      source: null,
      contextSummary: '',
      targetsSummary: '',
      sourceHintSummary: '',
      runtimeSummary: '',
      diagnostics: { runtimeEvents: [{ message: 'err1' }, { message: 'err2' }], truncated: false },
    };

    const compact = compactFrontendRequestResult(result) as Record<string, unknown>;
    expect(compact.diagnosticsSummary).toBe('runtimeEvents=2, truncated=false');
  });

});

function makeSession(overrides: Partial<UiInspectSession> = {}): UiInspectSession {
  const selection = overrides.selection ?? makeSelection();
  return {
    id: 'session-1',
    createdAt: 1000,
    updatedAt: 2000,
    status: 'sent',
    mode: 'single',
    selection,
    targets: [{
      id: selection.id,
      note: '',
      selection,
    }],
    messages: [],
    ...overrides,
  };
}

function makeSelection(overrides: Partial<UiInspectSelection> = {}): UiInspectSelection {
  return {
    id: 'selection-1',
    sessionId: 'session-1',
    url: 'http://localhost:5173',
    title: 'Example',
    timestamp: 2000,
    instruction: 'change this',
    framework: 'dom',
    dom: {
      selector: '#app',
      tagName: 'div',
      id: 'app',
      className: '',
      text: 'hello',
      outerHtml: '<div id="app">hello</div>',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      styles: {},
    },
    source: {
      root: '/project',
      file: 'src/App.vue',
      line: null,
      column: null,
    },
    ...overrides,
  };
}
