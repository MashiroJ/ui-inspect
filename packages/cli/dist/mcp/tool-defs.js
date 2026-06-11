// This file contains all MCP tool definitions.
// Each tool has a name, description, inputSchema, and annotations.
export const TOOL_DEFS = [
    {
        name: 'start_ui_inspect',
        description: 'Start or verify ui-inspect for a local frontend project. Use this when the user asks to start, enable, launch, open, use, invoke, or turn on ui-inspect, including "start ui-inspect", "enable ui-inspect", "use ui-inspect", "启用 ui-inspect", "使用 ui-inspect", "调用 ui-inspect", "打开 UI 检查", or requests to connect browser element selection to an MCP coding agent. Do not trigger on the bare word "ui-inspect" when the user is only asking about docs, installation, errors, or general information. Ensures the local daemon, detects the project integration status, and returns framework-specific next steps. Vite projects may be auto-installed/patched; Next.js projects may auto-install @ui-inspect/next but still return manual App Router or Pages Router file instructions. It never starts the user project dev server and never opens the browser.',
        inputSchema: {
            type: 'object',
            properties: {
                project: {
                    type: 'string',
                    description: 'Project directory where ui-inspect should be enabled. Defaults to the MCP process cwd.',
                },
            },
            additionalProperties: false,
        },
        annotations: {
            title: 'Start ui-inspect daemon',
            readOnlyHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: 'get_frontend_selection',
        description: 'Read the current browser-selected frontend element, user instruction, framework metadata, and source file hint from ui-inspect.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: {
            title: 'Get selected frontend element',
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: 'wait_for_frontend_request',
        description: 'Wait for the user to select a frontend element and click Send in the ui-inspect browser panel. Use immediately after start_ui_inspect for start/enable/use/invoke ui-inspect flows, so browser Send can continue the current AI conversation. Defaults to a 10 minute timeout; on timeout this tool shuts down the ui-inspect daemon and MCP process for this run. For continuous browser work, finish each returned task with complete_frontend_request instead of reply_to_user.',
        inputSchema: {
            type: 'object',
            properties: {
                timeoutMs: {
                    type: 'number',
                    description: 'Maximum time to wait in milliseconds. Defaults to 600000 and is capped at 600000.',
                },
                context: {
                    type: 'number',
                    description: 'Number of source lines before and after the selected source line. Defaults to 80.',
                },
                sinceTimestamp: {
                    type: 'number',
                    description: 'Only return user messages at or after this Unix timestamp in milliseconds. Defaults to now minus 30 seconds to avoid missing quick browser sends.',
                },
                afterRequestId: {
                    type: 'string',
                    description: 'Request cursor returned by the previous wait_for_frontend_request call. When provided, only newer browser requests are returned. Pass the nextCursor.afterRequestId value from the previous response.',
                },
                responseMode: {
                    type: 'string',
                    enum: ['compact', 'full'],
                    description: 'Return compact by default for MCP hosts such as Cursor. Use full only when raw session/source payload is required.',
                },
            },
            additionalProperties: false,
        },
        annotations: {
            title: 'Wait for frontend request',
            readOnlyHint: true,
            idempotentHint: false,
            openWorldHint: false,
        },
    },
    {
        name: 'get_frontend_source',
        description: 'Read source context around the selected frontend component/file. Use after get_frontend_selection.',
        inputSchema: {
            type: 'object',
            properties: {
                context: {
                    type: 'number',
                    description: 'Number of lines before and after the selected source line. Defaults to 80.',
                },
            },
            additionalProperties: false,
        },
        annotations: {
            title: 'Read selected source context',
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: 'get_frontend_sessions',
        description: 'List ui-inspect browser task records and their user/assistant messages.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: {
            title: 'List frontend task records',
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: 'update_ui_task_status',
        description: 'Update a ui-inspect browser task status so the user can see whether the AI has received, is working on, completed, or failed the task.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    description: 'ui-inspect session id. Defaults to the active session when omitted.',
                },
                status: {
                    type: 'string',
                    enum: ['claimed', 'working', 'done', 'failed'],
                    description: 'Task status shown in the browser panel.',
                },
            },
            required: ['status'],
            additionalProperties: false,
        },
        annotations: {
            title: 'Update UI task status',
            readOnlyHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    },
    {
        name: 'reply_to_user',
        description: 'Send an assistant reply into the current ui-inspect browser panel for progress or confirmation. For final task completion in the continuous browser loop, prefer complete_frontend_request so the agent immediately waits for the next browser request.',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'Reply shown in the browser task panel.',
                },
            },
            required: ['content'],
            additionalProperties: false,
        },
        annotations: {
            title: 'Reply in browser panel',
            readOnlyHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    },
    {
        name: 'complete_frontend_request',
        description: 'Complete the current ui-inspect browser request, send the final browser-panel reply, then immediately wait for the next browser request. Use this as the final step after handling a wait_for_frontend_request result so the user can keep sending tasks from the browser without returning to chat.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    description: 'Current ui-inspect session id from the browser request being completed.',
                },
                content: {
                    type: 'string',
                    description: 'Final reply shown in the browser panel for the current request.',
                },
                afterRequestId: {
                    type: 'string',
                    description: 'Cursor from the current request, usually nextCursor.afterRequestId. Required to avoid consuming the same browser request again.',
                },
                status: {
                    type: 'string',
                    enum: ['done', 'failed'],
                    description: 'Final task status for the current request. Defaults to done.',
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Maximum time to wait for the next browser request in milliseconds. Defaults to 600000 and is capped at 600000.',
                },
                context: {
                    type: 'number',
                    description: 'Number of source lines before and after the selected source line for the next request. Defaults to 80.',
                },
                sinceTimestamp: {
                    type: 'number',
                    description: 'Fallback timestamp filter used only when the cursor is unknown. Defaults to now minus 30 seconds.',
                },
                responseMode: {
                    type: 'string',
                    enum: ['compact', 'full'],
                    description: 'Return compact by default for MCP hosts such as Cursor. Use full only when raw session/source payload is required.',
                },
            },
            required: ['sessionId', 'content', 'afterRequestId'],
            additionalProperties: false,
        },
        annotations: {
            title: 'Complete request and wait',
            readOnlyHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    },
];
export function getMcpToolDefinition(name) {
    return TOOL_DEFS.find((tool) => tool.name === name);
}
//# sourceMappingURL=tool-defs.js.map