import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inspectNextIntegration } from './next-integration.js';
import { detectProject } from './project-detector.js';
import { getVersion } from './version.js';
const require = createRequire(import.meta.url);
const VITE_CONFIG_CANDIDATES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.cts'];
const PACKAGE_VERSION = getVersion();
const INTEGRATION_PACKAGES = {
    vite: '@ui-inspect/vite-plugin',
    next: '@ui-inspect/next',
    rsbuild: '@ui-inspect/rsbuild-plugin',
    rspack: '@ui-inspect/rspack-plugin',
    webpack: '@ui-inspect/webpack-plugin',
};
const INTEGRATION_PACKAGE_NAMES = Object.values(INTEGRATION_PACKAGES);
export function ensureProjectIntegration({ project }) {
    const detected = detectProject(project);
    const result = {
        project,
        packageJson: detected.packageJson,
        projectType: detected.kind,
        router: null,
        viteConfig: null,
        installed: false,
        patched: false,
        alreadyConfigured: false,
        devOnly: true,
        packageName: null,
        missing: [],
        nextSteps: [],
        warnings: [...detected.warnings],
    };
    if (!result.packageJson) {
        result.nextSteps = manualIntegrationSteps();
        return result;
    }
    if (detected.kind === 'next') {
        return ensureNextIntegration(project, detected.next?.router ?? 'unknown', result);
    }
    const configFile = findViteConfig(project);
    result.viteConfig = configFile;
    if (detected.kind === 'vite')
        result.packageName = INTEGRATION_PACKAGES.vite;
    if (!configFile) {
        if (detected.kind === 'unknown') {
            result.missing.push('project-integration');
            result.nextSteps = manualIntegrationSteps();
            result.warnings.push('frontend project type not detected; add ui-inspect manually for your framework.');
            return result;
        }
        if (detected.kind !== 'vite') {
            return ensureBundlerGuidance(detected.kind, detected.dependencies, result);
        }
        if (!hasProjectDependency(project, '@ui-inspect/vite-plugin')) {
            const installed = installProjectPackage(project, INTEGRATION_PACKAGES.vite);
            result.installed = installed;
            if (!installed)
                result.warnings.push('failed to install @ui-inspect/vite-plugin into the project');
        }
        result.warnings.push('vite.config.ts/js/mts/mjs not found; add uiInspect() manually');
        result.missing.push('vite-config');
        result.nextSteps = viteManualSteps();
        return result;
    }
    const patch = patchViteConfigFile(configFile);
    result.patched = patch.patched;
    result.alreadyConfigured = patch.alreadyConfigured;
    if (patch.warning)
        result.warnings.push(patch.warning);
    if (!result.alreadyConfigured && !hasProjectDependency(project, '@ui-inspect/vite-plugin')) {
        const installed = installProjectPackage(project, INTEGRATION_PACKAGES.vite);
        result.installed = installed;
        if (!installed)
            result.warnings.push('failed to install @ui-inspect/vite-plugin into the project');
    }
    result.nextSteps = result.alreadyConfigured || result.patched
        ? ['Start or keep using your frontend dev server, open the target page, then select an element with ui-inspect.']
        : viteManualSteps();
    return result;
}
export function updateProjectIntegrationPackages({ project, dryRun = false, tag = 'latest', silent = false, }) {
    const detected = detectProject(project);
    const packageJson = readProjectPackage(project);
    const result = {
        project,
        packageJson: Boolean(packageJson),
        projectType: detected.kind,
        packageManager: null,
        packages: [],
        warnings: [...detected.warnings],
        nextSteps: [],
    };
    if (!packageJson) {
        result.warnings.push('package.json not found; cannot update frontend integration packages automatically.');
        result.nextSteps.push('Run the install command for your frontend integration manually, for example npm install -D @ui-inspect/vite-plugin@latest.');
        return result;
    }
    const removedResolutions = removeUiInspectResolutions(project, packageJson, dryRun);
    if (removedResolutions.length > 0) {
        const action = dryRun ? 'Would remove' : 'Removed';
        result.warnings.push(`${action} ui-inspect Yarn resolutions: ${removedResolutions.join(', ')}`);
    }
    const packageNames = updatePackageNames(detected.kind, packageJson);
    if (packageNames.length === 0) {
        result.warnings.push('No ui-inspect frontend integration package was found or confidently detected.');
        result.nextSteps.push('Install the ui-inspect integration package for your frontend framework manually.');
        return result;
    }
    const manager = detectPackageManager(project);
    result.packageManager = manager;
    for (const name of packageNames) {
        const dependencyType = dependencyTypeFor(packageJson, name);
        const packageSpec = `${name}@${tag}`;
        const args = addPackageArgs(manager, packageSpec, dependencyType);
        const packageResult = {
            name,
            current: dependencyVersion(packageJson, name),
            dependencyType,
            target: packageSpec,
            command: manager,
            args,
            dryRun,
            updated: false,
            error: null,
        };
        if (!dryRun) {
            const spawnResult = spawnSync(manager, args, {
                cwd: project,
                stdio: silent ? 'pipe' : 'inherit',
                shell: process.platform === 'win32',
                env: packageManagerEnv(manager),
            });
            packageResult.updated = spawnResult.status === 0;
            if (!packageResult.updated) {
                packageResult.error = spawnResult.error?.message ?? `${manager} ${args.join(' ')} exited with ${spawnResult.status ?? 'unknown status'}`;
            }
        }
        result.packages.push(packageResult);
    }
    const failed = result.packages.filter((pkg) => !pkg.dryRun && !pkg.updated);
    if (failed.length > 0) {
        result.warnings.push(`Failed to update: ${failed.map((pkg) => pkg.name).join(', ')}`);
    }
    result.nextSteps.push('Restart your frontend dev server so the browser-injected ui-inspect client is refreshed.');
    result.nextSteps.push('Restart your MCP agent session if it keeps an old ui-inspect CLI process alive.');
    result.nextSteps.push('If your MCP config pins @ui-inspect/cli to an exact version, change it to @latest or update that pinned version manually.');
    return result;
}
function ensureNextIntegration(project, router, result) {
    const integration = inspectNextIntegration(project, router);
    result.projectType = 'next';
    result.router = router;
    result.packageName = INTEGRATION_PACKAGES.next;
    result.snippets = flattenNextSnippets(integration);
    result.missing = integration.missing;
    if (result.missing.includes(INTEGRATION_PACKAGES.next)) {
        const installed = installProjectPackage(project, INTEGRATION_PACKAGES.next);
        result.installed = installed;
        if (installed) {
            result.missing = result.missing.filter((item) => item !== INTEGRATION_PACKAGES.next);
        }
        else {
            result.warnings.push(`failed to install ${INTEGRATION_PACKAGES.next} into the project`);
        }
    }
    result.alreadyConfigured = result.missing.length === 0;
    if (result.missing.length === 0) {
        result.nextSteps = ['Start or keep using your Next.js dev server, open the target page, then select an element with ui-inspect.'];
        return result;
    }
    result.nextSteps = nextIntegrationSteps(router, integration, result.missing);
    result.warnings.push('Next.js project files are not patched automatically; add UiInspectScript and the Diana route manually.');
    return result;
}
function flattenNextSnippets(integration) {
    const snippets = {
        install: `pnpm add -D @ui-inspect/next@${PACKAGE_VERSION}`,
    };
    if (integration.snippets.appRouter) {
        snippets.appLayout = integration.snippets.appRouter.script;
        snippets.appRoute = `${integration.snippets.appRouter.route}\n`;
    }
    if (integration.snippets.pagesRouter) {
        snippets.pagesApp = integration.snippets.pagesRouter.script;
        snippets.pagesApi = `${integration.snippets.pagesRouter.route}\n`;
    }
    return snippets;
}
function ensureBundlerGuidance(kind, dependencies, result) {
    const packageName = INTEGRATION_PACKAGES[kind];
    result.packageName = packageName;
    if (!dependencies[packageName])
        result.missing.push(packageName);
    result.missing.push(`${kind}-config`);
    result.nextSteps = bundlerIntegrationSteps(kind, packageName);
    result.warnings.push(`${kind} projects are not patched automatically; add the ui-inspect plugin manually.`);
    return result;
}
function readProjectPackage(project) {
    try {
        return JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
    }
    catch {
        return null;
    }
}
function hasProjectDependency(project, name) {
    return hasDependency(readProjectPackage(project), name);
}
function hasDependency(packageJson, name) {
    return Boolean(packageJson?.dependencies?.[name] || packageJson?.devDependencies?.[name]);
}
function installProjectPackage(project, packageName) {
    const pluginSpec = process.env.UI_INSPECT_PROJECT_INSTALL_SOURCE === 'local'
        ? packageRoot(packageName)
        : `${packageName}@${PACKAGE_VERSION}`;
    if (!pluginSpec)
        return false;
    const manager = detectPackageManager(project);
    const command = manager;
    const args = addPackageArgs(manager, pluginSpec, 'devDependencies');
    const result = spawnSync(command, args, {
        cwd: project,
        stdio: 'ignore',
        shell: process.platform === 'win32',
        env: packageManagerEnv(manager),
    });
    return result.status === 0;
}
function updatePackageNames(kind, packageJson) {
    const names = new Set();
    if (kind !== 'unknown')
        names.add(INTEGRATION_PACKAGES[kind]);
    for (const name of Object.keys(packageJson.dependencies ?? {})) {
        if (name.startsWith('@ui-inspect/'))
            names.add(name);
    }
    for (const name of Object.keys(packageJson.devDependencies ?? {})) {
        if (name.startsWith('@ui-inspect/'))
            names.add(name);
    }
    for (const name of INTEGRATION_PACKAGE_NAMES) {
        if (hasDependency(packageJson, name))
            names.add(name);
    }
    return [...names];
}
function removeUiInspectResolutions(project, packageJson, dryRun) {
    const resolutions = packageJson.resolutions;
    if (!resolutions)
        return [];
    const names = Object.keys(resolutions).filter((name) => name.startsWith('@ui-inspect/'));
    if (names.length === 0)
        return [];
    if (dryRun)
        return names;
    for (const name of names) {
        delete resolutions[name];
    }
    if (Object.keys(resolutions).length === 0) {
        delete packageJson.resolutions;
    }
    writeFileSync(join(project, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    return names;
}
function dependencyVersion(packageJson, name) {
    return packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name] ?? null;
}
function dependencyTypeFor(packageJson, name) {
    if (packageJson.dependencies?.[name])
        return 'dependencies';
    if (packageJson.devDependencies?.[name])
        return 'devDependencies';
    return null;
}
function addPackageArgs(manager, packageSpec, dependencyType) {
    const dev = dependencyType !== 'dependencies';
    if (manager === 'pnpm')
        return dev ? ['add', '-D', packageSpec] : ['add', packageSpec];
    if (manager === 'yarn')
        return yarnAddArgs(packageSpec, dev);
    return dev ? ['install', '--save-dev', packageSpec] : ['install', '--save', packageSpec];
}
function yarnAddArgs(pluginSpec, dev = true) {
    const args = dev ? ['add', '-D', pluginSpec] : ['add', pluginSpec];
    if (pluginSpec.startsWith('@mashiro39/')) {
        return [...args, '--registry', 'https://registry.npmjs.org'];
    }
    return args;
}
function packageManagerEnv(manager) {
    return manager === 'yarn'
        ? { ...process.env, COREPACK_ENABLE_STRICT: '0' }
        : process.env;
}
function detectPackageManager(project) {
    const packageManager = packageManagerField(project);
    if (packageManager?.startsWith('yarn@'))
        return 'yarn';
    if (existsSync(join(project, 'yarn.lock')))
        return 'yarn';
    if (packageManager?.startsWith('pnpm@'))
        return 'pnpm';
    if (packageManager?.startsWith('npm@'))
        return 'npm';
    if (existsSync(join(project, 'pnpm-lock.yaml')))
        return 'pnpm';
    return commandExists('yarn') ? 'yarn' : 'npm';
}
function packageManagerField(project) {
    try {
        const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
        return typeof packageJson.packageManager === 'string' ? packageJson.packageManager : null;
    }
    catch {
        return null;
    }
}
function commandExists(command) {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
    });
    return result.status === 0;
}
function packageRoot(name) {
    try {
        return require.resolve(`${name}/package.json`).replace(/[/\\]package\.json$/, '');
    }
    catch {
        return null;
    }
}
function findViteConfig(project) {
    for (const name of VITE_CONFIG_CANDIDATES) {
        const file = join(project, name);
        if (existsSync(file))
            return file;
    }
    return null;
}
function nextIntegrationSteps(router, integration, missing = integration.missing) {
    const install = `Install package ${INTEGRATION_PACKAGES.next}: pnpm add -D @ui-inspect/next@${PACKAGE_VERSION}`;
    const steps = [`Missing: ${missing.join(', ')}`];
    if (missing.includes(INTEGRATION_PACKAGES.next))
        steps.push(install);
    if (router === 'app') {
        if (missing.includes('UiInspectScript')) {
            steps.push('In app/layout.tsx or src/app/layout.tsx, render <UiInspectScript /> in the root layout body. Copy snippet "appLayout" if you need a starting point.');
        }
        if (missing.includes('diana-route')) {
            steps.push('Create app/api/ui-inspect/diana/route.ts or src/app/api/ui-inspect/diana/route.ts for Diana. Copy snippet "appRoute".');
        }
        return steps;
    }
    if (router === 'pages') {
        if (missing.includes('UiInspectScript')) {
            steps.push('In pages/_app.tsx or src/pages/_app.tsx, render <UiInspectScript /> alongside the page component. Copy snippet "pagesApp" if you need a starting point.');
        }
        if (missing.includes('diana-route')) {
            steps.push('Create pages/api/ui-inspect/diana.ts or src/pages/api/ui-inspect/diana.ts for Diana. Copy snippet "pagesApi".');
        }
        return steps;
    }
    if (missing.includes('UiInspectScript') || missing.includes('diana-route')) {
        steps.push('For App Router, add <UiInspectScript /> to the root layout and add the Diana route handler from "@ui-inspect/next/app". Copy snippets "appLayout" and "appRoute".');
        steps.push('For Pages Router, add <UiInspectScript /> to _app and add the Diana API handler from "@ui-inspect/next/pages". Copy snippets "pagesApp" and "pagesApi".');
    }
    return steps;
}
function bundlerIntegrationSteps(kind, packageName) {
    if (kind === 'rsbuild') {
        return [
            `Install ${packageName}@${PACKAGE_VERSION} as a dev dependency.`,
            'Import { pluginUiInspect } from "@ui-inspect/rsbuild-plugin" in rsbuild.config and add pluginUiInspect() to the plugins array.',
        ];
    }
    return [
        `Install ${packageName}@${PACKAGE_VERSION} as a dev dependency.`,
        `Import { uiInspect } from "${packageName}" in ${kind}.config and add uiInspect() to the plugins array.`,
    ];
}
function viteManualSteps() {
    return [
        `Install @ui-inspect/vite-plugin@${PACKAGE_VERSION} as a dev dependency.`,
        'Import { uiInspect } from "@ui-inspect/vite-plugin" in vite.config and add uiInspect() to the plugins array.',
    ];
}
function manualIntegrationSteps() {
    return [
        'Add the ui-inspect package for your frontend framework.',
        'Mount the ui-inspect client script in development only.',
        'Expose the Diana asset route expected by the client integration.',
    ];
}
function patchViteConfigFile(file) {
    let content = readFileSync(file, 'utf8');
    content = content.replace(/^import\s+\{\s*uiInspect\s*\}\s+from\s+['"]@ui-inspect\/vite-plugin['"];\s*\n?/gm, '');
    const hadImport = content.includes('@ui-inspect/vite-plugin');
    const hadCall = /\buiInspect\s*\(/.test(content);
    if (hadImport && hadCall)
        return { patched: false, alreadyConfigured: true };
    if (!hadImport) {
        const importLine = "import { uiInspect } from '@ui-inspect/vite-plugin';\n";
        const imports = [...content.matchAll(/^import\s.+?;\s*$/gm)];
        if (imports.length > 0) {
            const last = imports[imports.length - 1];
            const insertAt = (last.index || 0) + last[0].length;
            content = `${content.slice(0, insertAt)}\n${importLine.trimEnd()}${content.slice(insertAt)}`;
        }
        else {
            content = importLine + content;
        }
    }
    if (!hadCall) {
        const pluginsMatch = content.match(/plugins\s*:\s*\[/);
        if (!pluginsMatch || pluginsMatch.index === undefined) {
            writeFileSync(file, content);
            return { patched: true, alreadyConfigured: false, warning: 'plugins array not found; import was added but uiInspect() must be added manually' };
        }
        const insertAt = pluginsMatch.index + pluginsMatch[0].length;
        content = `${content.slice(0, insertAt)}uiInspect(), ${content.slice(insertAt)}`;
    }
    writeFileSync(file, content);
    return { patched: true, alreadyConfigured: false };
}
//# sourceMappingURL=project-setup.js.map