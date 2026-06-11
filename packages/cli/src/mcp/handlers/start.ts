import { resolveProjectRoot } from '../project-root.js';
import { ensureDaemon } from '../../daemon.js';
import { ensureProjectIntegration } from '../../project-setup.js';

export async function startUiInspectHandler(args: unknown, daemonUrl: string): Promise<unknown> {
  const project = typeof args === 'object' && args !== null && 'project' in args
    ? (args as { project?: unknown }).project
    : undefined;
  const projectRoot = resolveProjectRoot(project);
  const daemon = await ensureDaemon({ daemonUrl, project: projectRoot });
  const integration = ensureProjectIntegration({ project: projectRoot });
  return { ok: true, projectRoot, daemon, integration };
}
