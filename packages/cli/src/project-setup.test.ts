import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureProjectIntegration, updateProjectIntegrationPackages } from './project-setup.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ensureProjectIntegration', () => {
  it('keeps the Vite auto-patch path and legacy fields', () => {
    const project = tempProject({
      dependencies: { vite: '^6.0.0' },
      devDependencies: { '@ui-inspect/vite-plugin': '0.1.16' },
    });
    writeFileSync(join(project, 'vite.config.ts'), [
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      '  plugins: [],',
      '});',
      '',
    ].join('\n'));

    const result = ensureProjectIntegration({ project });

    expect(result.packageJson).toBe(true);
    expect(result.viteConfig).toBe(join(project, 'vite.config.ts'));
    expect(result.installed).toBe(false);
    expect(result.patched).toBe(true);
    expect(result.alreadyConfigured).toBe(false);
    expect(result.devOnly).toBe(true);
    expect(result.projectType).toBe('vite');
    expect(result.packageName).toBe('@ui-inspect/vite-plugin');
    expect(result.snippets).toBeUndefined();
    expect(readFileSync(join(project, 'vite.config.ts'), 'utf8')).toContain('uiInspect(),');
  });

  it('returns complete App Router status for an integrated Next.js project', () => {
    const project = tempProject({
      dependencies: { next: '^16.0.0' },
      devDependencies: { '@ui-inspect/next': '0.1.16' },
    });
    writeFile(project, 'app/layout.tsx', [
      "import { UiInspectScript } from '@ui-inspect/next';",
      '',
      'export default function RootLayout({ children }) {',
      '  return <html><body>{children}<UiInspectScript /></body></html>;',
      '}',
    ].join('\n'));
    writeFile(project, 'app/api/ui-inspect/diana/route.ts', "export { GET } from '@ui-inspect/next/app';\n");

    const result = ensureProjectIntegration({ project });

    expect(result.projectType).toBe('next');
    expect(result.router).toBe('app');
    expect(result.packageName).toBe('@ui-inspect/next');
    expect(result.missing).toEqual([]);
    expect(result.alreadyConfigured).toBe(true);
    expect(result.nextSteps).toEqual(['Start or keep using your Next.js dev server, open the target page, then select an element with ui-inspect.']);
    expect(result.snippets).toEqual({
      install: expect.stringContaining('pnpm add -D @ui-inspect/next@'),
      appLayout: expect.stringContaining('<UiInspectScript />'),
      appRoute: "export { GET } from '@ui-inspect/next/app';\n",
    });
  });

  it('returns complete Pages Router status for an integrated Next.js project', () => {
    const project = tempProject({
      dependencies: { next: '^16.0.0', '@ui-inspect/next': '0.1.16' },
    });
    writeFile(project, 'pages/_app.tsx', [
      "import { UiInspectScript } from '@ui-inspect/next';",
      '',
      'export default function App({ Component, pageProps }) {',
      '  return <><Component {...pageProps} /><UiInspectScript /></>;',
      '}',
    ].join('\n'));
    writeFile(project, 'pages/api/ui-inspect/diana.ts', "export { dianaHandler as default } from '@ui-inspect/next/pages';\n");

    const result = ensureProjectIntegration({ project });

    expect(result.projectType).toBe('next');
    expect(result.router).toBe('pages');
    expect(result.packageName).toBe('@ui-inspect/next');
    expect(result.missing).toEqual([]);
    expect(result.alreadyConfigured).toBe(true);
    expect(result.nextSteps).toEqual(['Start or keep using your Next.js dev server, open the target page, then select an element with ui-inspect.']);
    expect(result.snippets).toEqual({
      install: expect.stringContaining('pnpm add -D @ui-inspect/next@'),
      pagesApp: expect.stringContaining('<UiInspectScript />'),
      pagesApi: "export { dianaHandler as default } from '@ui-inspect/next/pages';\n",
    });
  });

  it('returns App Router guidance for Next.js without patching user files', () => {
    const project = tempProject({ packageManager: 'npm@10.0.0', dependencies: { next: '^16.0.0' } });
    writeFile(project, 'app/layout.tsx', 'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }');
    const previousPath = installFakePackageManager(project, 'npm');

    try {
      const result = ensureProjectIntegration({ project });

      expect(result.projectType).toBe('next');
      expect(result.router).toBe('app');
      expect(result.installed).toBe(true);
      expect(result.patched).toBe(false);
      expect(result.alreadyConfigured).toBe(false);
      expect(result.missing).toEqual(['UiInspectScript', 'diana-route']);
      expect(result.nextSteps.join('\n')).toContain('app/layout.tsx');
      expect(result.nextSteps.join('\n')).toContain('snippet "appRoute"');
      expect(result.nextSteps.join('\n')).not.toContain('Install package @ui-inspect/next');
      expect(result.snippets).toEqual({
        install: expect.stringContaining('pnpm add -D @ui-inspect/next@'),
        appLayout: expect.stringContaining("import { UiInspectScript } from '@ui-inspect/next';"),
        appRoute: "export { GET } from '@ui-inspect/next/app';\n",
      });
      expect(readFileSync(join(project, 'app/layout.tsx'), 'utf8')).not.toContain('UiInspectScript');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('returns Pages Router guidance for Next.js without patching user files', () => {
    const project = tempProject({ packageManager: 'npm@10.0.0', dependencies: { next: '^16.0.0' } });
    writeFile(project, 'pages/_app.tsx', 'export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }');
    const previousPath = installFakePackageManager(project, 'npm');

    try {
      const result = ensureProjectIntegration({ project });

      expect(result.projectType).toBe('next');
      expect(result.router).toBe('pages');
      expect(result.installed).toBe(true);
      expect(result.patched).toBe(false);
      expect(result.alreadyConfigured).toBe(false);
      expect(result.missing).toEqual(['UiInspectScript', 'diana-route']);
      expect(result.nextSteps.join('\n')).toContain('pages/_app.tsx');
      expect(result.nextSteps.join('\n')).toContain('snippet "pagesApi"');
      expect(result.nextSteps.join('\n')).not.toContain('Install package @ui-inspect/next');
      expect(result.snippets).toEqual({
        install: expect.stringContaining('pnpm add -D @ui-inspect/next@'),
        pagesApp: expect.stringContaining("import { UiInspectScript } from '@ui-inspect/next';"),
        pagesApi: "export { dianaHandler as default } from '@ui-inspect/next/pages';\n",
      });
      expect(readFileSync(join(project, 'pages/_app.tsx'), 'utf8')).not.toContain('UiInspectScript');
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('returns manual guidance for unknown projects', () => {
    const project = tempProject({ dependencies: { react: '^19.0.0' } });

    const result = ensureProjectIntegration({ project });

    expect(result.projectType).toBe('unknown');
    expect(result.viteConfig).toBe(null);
    expect(result.installed).toBe(false);
    expect(result.patched).toBe(false);
    expect(result.missing).toEqual(['project-integration']);
    expect(result.nextSteps.join('\n')).toContain('Mount the ui-inspect client script');
  });

  it('returns Rsbuild plugin guidance without patching config', () => {
    const project = tempProject({
      devDependencies: { '@rsbuild/core': '^1.0.0' },
    });
    writeFile(project, 'rsbuild.config.ts', 'export default { plugins: [] };');

    const result = ensureProjectIntegration({ project });

    expect(result.projectType).toBe('rsbuild');
    expect(result.packageName).toBe('@ui-inspect/rsbuild-plugin');
    expect(result.installed).toBe(false);
    expect(result.patched).toBe(false);
    expect(result.missing).toEqual(['@ui-inspect/rsbuild-plugin', 'rsbuild-config']);
    expect(result.nextSteps.join('\n')).toContain('pluginUiInspect');
  });

  it('returns Rspack plugin guidance without patching config', () => {
    const project = tempProject({
      devDependencies: { '@rspack/core': '^1.0.0' },
    });
    writeFile(project, 'rspack.config.js', 'module.exports = { plugins: [] };');

    const result = ensureProjectIntegration({ project });

    expect(result.projectType).toBe('rspack');
    expect(result.packageName).toBe('@ui-inspect/rspack-plugin');
    expect(result.installed).toBe(false);
    expect(result.patched).toBe(false);
    expect(result.missing).toEqual(['@ui-inspect/rspack-plugin', 'rspack-config']);
    expect(result.nextSteps.join('\n')).toContain('uiInspect');
  });
});

describe('updateProjectIntegrationPackages', () => {
  it('plans a Vite plugin update with the detected package manager', () => {
    const project = tempProject({
      packageManager: 'pnpm@10.0.0',
      dependencies: { vite: '^6.0.0' },
      devDependencies: { '@ui-inspect/vite-plugin': '0.1.16' },
    });
    writeFileSync(join(project, 'vite.config.ts'), 'export default { plugins: [] };\n');

    const result = updateProjectIntegrationPackages({ project, dryRun: true });

    expect(result.projectType).toBe('vite');
    expect(result.packageManager).toBe('pnpm');
    expect(result.packages).toEqual([
      expect.objectContaining({
        name: '@ui-inspect/vite-plugin',
        current: '0.1.16',
        dependencyType: 'devDependencies',
        target: '@ui-inspect/vite-plugin@latest',
        command: 'pnpm',
        args: ['add', '-D', '@ui-inspect/vite-plugin@latest'],
        dryRun: true,
        updated: false,
        error: null,
      }),
    ]);
    expect(result.nextSteps.join('\n')).toContain('Restart your frontend dev server');
  });

  it('updates existing ui-inspect packages even when project type is unknown', () => {
    const project = tempProject({
      packageManager: 'npm@10.0.0',
      dependencies: { '@ui-inspect/protocol': '0.2.0' },
      devDependencies: {
        '@ui-inspect/browser-ui': '0.2.0',
        '@ui-inspect/webpack-plugin': '0.2.0',
      },
    });

    const result = updateProjectIntegrationPackages({ project, dryRun: true });

    expect(result.projectType).toBe('unknown');
    expect(result.packageManager).toBe('npm');
    expect(result.packages.map((pkg) => pkg.name)).toEqual([
      '@ui-inspect/protocol',
      '@ui-inspect/browser-ui',
      '@ui-inspect/webpack-plugin',
    ]);
    expect(result.packages[0]).toEqual(expect.objectContaining({
      dependencyType: 'dependencies',
      args: ['install', '--save', '@ui-inspect/protocol@latest'],
    }));
    expect(result.packages[1]).toEqual(expect.objectContaining({
      dependencyType: 'devDependencies',
      args: ['install', '--save-dev', '@ui-inspect/browser-ui@latest'],
    }));
  });

  it('preserves dependency section when the integration package is a production dependency', () => {
    const project = tempProject({
      packageManager: 'yarn@1.22.0',
      dependencies: { next: '^16.0.0', '@ui-inspect/next': '0.2.0' },
    });
    writeFile(project, 'app/layout.tsx', 'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }');

    const result = updateProjectIntegrationPackages({ project, dryRun: true });

    expect(result.packageManager).toBe('yarn');
    expect(result.packages[0]).toEqual(expect.objectContaining({
      name: '@ui-inspect/next',
      dependencyType: 'dependencies',
      args: ['add', '@ui-inspect/next@latest'],
    }));
  });

  it('reports ui-inspect Yarn resolutions during dry run', () => {
    const project = tempProject({
      packageManager: 'yarn@1.22.22',
      dependencies: { vite: '^6.0.0' },
      devDependencies: { '@ui-inspect/vite-plugin': '0.2.0' },
      resolutions: {
        '@ui-inspect/vite-plugin': 'file:.ui-inspect-local/ui-inspect-vite-plugin-0.1.19.tgz',
        lodash: '^4.17.21',
      },
    });

    const result = updateProjectIntegrationPackages({ project, dryRun: true });

    expect(result.warnings.join('\n')).toContain('Would remove ui-inspect Yarn resolutions: @ui-inspect/vite-plugin');
    const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { resolutions?: Record<string, string> };
    expect(packageJson.resolutions?.['@ui-inspect/vite-plugin']).toContain('.ui-inspect-local');
  });

  it('removes ui-inspect Yarn resolutions before installing updates', () => {
    const project = tempProject({
      packageManager: 'yarn@1.22.22',
      dependencies: { vite: '^6.0.0' },
      devDependencies: { '@ui-inspect/vite-plugin': '0.2.0' },
      resolutions: {
        '@ui-inspect/vite-plugin': 'file:.ui-inspect-local/ui-inspect-vite-plugin-0.1.19.tgz',
        '@ui-inspect/shared': 'file:.ui-inspect-local/ui-inspect-shared-0.1.19.tgz',
        lodash: '^4.17.21',
      },
    });
    const bin = join(project, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yarn'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'yarn'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ''}`;

    try {
      const result = updateProjectIntegrationPackages({ project, dryRun: false, silent: true });

      expect(result.warnings.join('\n')).toContain('Removed ui-inspect Yarn resolutions: @ui-inspect/vite-plugin, @ui-inspect/shared');
      const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { resolutions?: Record<string, string> };
      expect(packageJson.resolutions).toEqual({ lodash: '^4.17.21' });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('returns manual guidance when package.json is missing', () => {
    const project = mkdtempSync(join(tmpdir(), 'ui-inspect-cli-test-'));
    roots.push(project);

    const result = updateProjectIntegrationPackages({ project, dryRun: true });

    expect(result.packageJson).toBe(false);
    expect(result.packages).toEqual([]);
    expect(result.warnings.join('\n')).toContain('package.json not found');
  });
});

function tempProject(packageJson: Record<string, unknown>): string {
  const project = mkdtempSync(join(tmpdir(), 'ui-inspect-cli-test-'));
  roots.push(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify(packageJson, null, 2));
  return project;
}

function installFakePackageManager(project: string, command: string): string | undefined {
  const bin = join(project, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, command), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  return previousPath;
}

function writeFile(project: string, name: string, content: string): void {
  mkdirSync(join(project, name, '..'), { recursive: true });
  writeFileSync(join(project, name), content);
}
