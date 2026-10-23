#!/usr/bin/env node
/**
 * Multi-Department Onboarding & Deployment Workflow (Option B: Dedicated Firebase Project per Department)
 *
 * Commands:
 *   npm run dept:list
 *   npm run dept:onboard -- <slug> [--name "Department Name"] [--project <projectId>] [--create-project] [--demo]
 *   npm run dept:deploy  -- <slug> [--only all|hosting|rules|storage|database|functions]
 *   npm run dept:dev     -- <slug>
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEPARTMENTS_PATH = resolve(ROOT, 'departments.json');
const FIREBASERC_PATH = resolve(ROOT, '.firebaserc');

const readJson = (path, fallback = {}) => {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
};

const writeJson = (path, data) => {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
};

const runFirebaseJson = (args) => {
  try {
    const out = execFileSync('npx', ['firebase', ...args, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    const stdout = err && err.stdout ? String(err.stdout) : '';
    try {
      return JSON.parse(stdout);
    } catch {
      return { status: 'error', error: (err && err.message) || 'Firebase CLI command failed' };
    }
  }
};

const runInteractive = (cmd, args, envOverrides = {}) => {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
  });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
};

const cmdList = () => {
  const registry = readJson(DEPARTMENTS_PATH, { departments: {} });
  const firebaserc = readJson(FIREBASERC_PATH, { projects: {}, targets: {} });
  const entries = Object.values(registry.departments || {});

  console.log('\nStationSync Registered Departments');
  console.log('================================================================================');
  if (entries.length === 0) {
    console.log('No departments registered in departments.json.');
    return;
  }

  for (const dept of entries) {
    const envPath = resolve(ROOT, dept.envFile || `.env.${dept.slug}`);
    const hasEnv = existsSync(envPath);
    const hasAlias = Boolean(firebaserc.projects && firebaserc.projects[dept.slug] === dept.projectId);
    const hasTarget = Boolean(
      firebaserc.targets &&
        firebaserc.targets[dept.projectId] &&
        firebaserc.targets[dept.projectId].hosting &&
        Array.isArray(firebaserc.targets[dept.projectId].hosting.default)
    );

    console.log(
      `• ${dept.slug.padEnd(10)} | ${dept.name.padEnd(36)} | https://${dept.subdomain}\n` +
        `             Project: ${dept.projectId} ${dept.isDemo ? '[DEMO]' : ''}\n` +
        `             Config : ${dept.envFile} (${hasEnv ? '✔ present' : '✖ missing'}) | .firebaserc (${hasAlias && hasTarget ? '✔ mapped' : '✖ incomplete'})\n`
    );
  }
};

const syncFirebaserc = (slug, projectId, hostingSite) => {
  const firebaserc = readJson(FIREBASERC_PATH, { projects: {}, targets: {}, etags: {} });
  firebaserc.projects = firebaserc.projects || {};
  firebaserc.targets = firebaserc.targets || {};

  firebaserc.projects[slug] = projectId;
  firebaserc.targets[projectId] = firebaserc.targets[projectId] || {};
  firebaserc.targets[projectId].hosting = firebaserc.targets[projectId].hosting || {};
  firebaserc.targets[projectId].hosting.default = [hostingSite || projectId];

  writeJson(FIREBASERC_PATH, firebaserc);
};

const fetchAndWriteEnvFile = (dept) => {
  const { projectId, envFile, name } = dept;
  const envPath = resolve(ROOT, envFile);

  console.log(`\nChecking Firebase project "${projectId}" for Web App configuration...`);
  const appsRes = runFirebaseJson(['apps:list', 'WEB', '--project', projectId]);
  if (appsRes.status !== 'success') {
    console.log(
      `  ! Could not list Web Apps for project "${projectId}" yet.\n` +
        `    (Make sure the Firebase project "${projectId}" exists in the Firebase Console or pass --create-project.)`
    );
    return false;
  }

  let apps = Array.isArray(appsRes.result) ? appsRes.result : [];
  let appId = apps[0] && apps[0].appId;

  if (!appId) {
    console.log(`  No Web App found in "${projectId}". Creating Web App "${name}"...`);
    const createRes = runFirebaseJson(['apps:create', 'WEB', name, '--project', projectId]);
    if (createRes.status === 'success' && createRes.result && createRes.result.appId) {
      appId = createRes.result.appId;
    } else {
      console.log(`  ! Failed to create Web App automatically: ${createRes.error || 'unknown error'}`);
      return false;
    }
  }

  console.log(`  Fetching SDK config for Web App ${appId}...`);
  const sdkRes = runFirebaseJson(['apps:sdkconfig', 'WEB', appId, '--project', projectId]);
  const sdk = sdkRes && sdkRes.result && sdkRes.result.sdkConfig;
  if (!sdk || !sdk.apiKey) {
    console.log(`  ! Failed to fetch SDK config for ${appId}.`);
    return false;
  }

  const lines = [
    `# StationSync Environment Configuration — ${name} (${dept.subdomain})`,
    `# Generated automatically by scripts/department-workflow.mjs`,
    `VITE_FIREBASE_API_KEY=${sdk.apiKey || ''}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${sdk.authDomain || `${projectId}.firebaseapp.com`}`,
    `VITE_FIREBASE_PROJECT_ID=${sdk.projectId || projectId}`,
    `VITE_FIREBASE_STORAGE_BUCKET=${sdk.storageBucket || `${projectId}.firebasestorage.app`}`,
    `VITE_FIREBASE_MESSAGING_SENDER_ID=${sdk.messagingSenderId || ''}`,
    `VITE_FIREBASE_APP_ID=${sdk.appId || appId}`,
    `VITE_FIREBASE_DATABASE_URL=${sdk.databaseURL || `https://${projectId}-default-rtdb.firebaseio.com`}`,
    `VITE_FIRESTORE_FEATURES=all`,
    `# Explicitly clear project-specific keys so Vite does not inherit BVFD's values from .env`,
    `VITE_FIREBASE_APPCHECK_SITE_KEY=`,
    `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=`,
    `VITE_FIREBASE_VAPID_KEY=`,
    `VITE_FIREBASE_MEASUREMENT_ID=`,
    `VITE_FIREBASE_EMULATOR=`,
    '',
  ];

  writeFileSync(envPath, lines.join('\n'), 'utf8');
  console.log(`✔ Wrote Firebase Web SDK config to ${envFile}`);
  return true;
};

const cmdOnboard = (positional, flags) => {
  const rawSlug = String(positional[0] || '').trim().toLowerCase();
  if (!rawSlug || !/^[a-z0-9-]+$/.test(rawSlug)) {
    console.error(
      'Usage: npm run dept:onboard -- <slug> [--name "Department Name"] [--project <projectId>] [--create-project] [--demo]'
    );
    process.exit(1);
  }

  const registry = readJson(DEPARTMENTS_PATH, { departments: {} });
  const existing = (registry.departments && registry.departments[rawSlug]) || {};

  const projectId = String(flags.project || existing.projectId || `stationsync-${rawSlug}`).trim();
  const name = String(flags.name || existing.name || `StationSync — ${rawSlug.toUpperCase()}`).trim();
  const subdomain = String(flags.subdomain || existing.subdomain || `${rawSlug}.stationsync.net`).trim();
  const envFile = existing.envFile || (rawSlug === 'bvfd' ? '.env' : `.env.${rawSlug}`);
  const isDemo = Boolean(flags.demo || existing.isDemo || rawSlug === 'demo');

  const dept = {
    slug: rawSlug,
    name,
    subdomain,
    projectId,
    hostingTarget: 'default',
    hostingSite: projectId,
    envFile,
    isDemo,
  };

  registry.departments = registry.departments || {};
  registry.departments[rawSlug] = dept;
  writeJson(DEPARTMENTS_PATH, registry);
  console.log(`✔ Registered department "${rawSlug}" (${name}) in departments.json`);

  syncFirebaserc(rawSlug, projectId, dept.hostingSite);
  console.log(`✔ Updated .firebaserc with project alias "${rawSlug}" -> "${projectId}" and default hosting target`);

  if (flags['create-project']) {
    const gcpDisplayName =
      name
        .replace(/&/g, 'and')
        .replace(/[^a-zA-Z0-9\s'!-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30) || rawSlug;
    console.log(`\nCreating Firebase project "${projectId}" (GCP display name: "${gcpDisplayName}")...`);
    runInteractive('npx', ['firebase', 'projects:create', projectId, '--display-name', gcpDisplayName]);
  }

  const envReady = fetchAndWriteEnvFile(dept);

  console.log('\n================================================================================');
  console.log(`Onboarding Summary for "${name}" (${subdomain})`);
  console.log('================================================================================');
  console.log(`  Department Slug : ${rawSlug}`);
  console.log(`  Firebase Project: ${projectId}`);
  console.log(`  Subdomain       : https://${subdomain}`);
  console.log(`  Env Config File : ${envFile} (${envReady ? 'Ready' : 'Pending Firebase Project Creation'})`);
  console.log('\nOne-Time Firebase Console Setup Checklist:');
  console.log(`  1. Open https://console.firebase.google.com/project/${projectId}/overview`);
  if (!envReady) {
    console.log(`     (Create project "${projectId}" first, then re-run: npm run dept:onboard -- ${rawSlug})`);
  }
  console.log('  2. Authentication -> Sign-in method -> Enable "Email/Password".');
  console.log('  3. Firestore Database -> Create "(default)" database in Production mode.');
  console.log('  4. Realtime Database -> Create default database (used for live presence & typing indicators).');
  console.log('  5. Storage -> Get Started -> Enable default bucket, then grant Cloud Datastore Viewer to Storage agent.');
  console.log('  6. Upgrade project to Blaze plan (required when deploying Cloud Functions).');
  console.log(`  7. Hosting -> Add custom domain "${subdomain}" and add the DNS records to stationsync.net.`);
  console.log('\nUseful Commands:');
  console.log(`  • Local Dev Server      : npm run dept:dev -- ${rawSlug}`);
  console.log(`  • Deploy Rules & Hosting: npm run dept:deploy -- ${rawSlug} --only rules,hosting`);
  console.log(`  • Deploy Everything     : npm run dept:deploy -- ${rawSlug}`);
  if (isDemo) {
    console.log(`  • Seed Demo Data        : npm run dept:seed-demo -- ${rawSlug}`);
  }
  console.log('================================================================================\n');
};

const cmdDeploy = (positional, flags) => {
  const rawSlug = String(positional[0] || '').trim().toLowerCase();
  if (!rawSlug) {
    console.error('Usage: npm run dept:deploy -- <slug> [--only all|hosting|rules|storage|database|functions]');
    process.exit(1);
  }

  const registry = readJson(DEPARTMENTS_PATH, { departments: {} });
  const dept = registry.departments && registry.departments[rawSlug];
  if (!dept) {
    console.error(`Unknown department "${rawSlug}". Run "npm run dept:list" to see configured departments.`);
    process.exit(1);
  }

  const envPath = resolve(ROOT, dept.envFile);
  if (!existsSync(envPath)) {
    console.error(
      `Missing ${dept.envFile} for department "${rawSlug}".\n` +
        `Run "npm run dept:onboard -- ${rawSlug}" after creating the Firebase project "${dept.projectId}" to generate it.`
    );
    process.exit(1);
  }

  const onlyRaw = String(flags.only || 'all').trim().toLowerCase();
  const parts = onlyRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const deployAll = parts.includes('all');

  const needsBuild = deployAll || parts.includes('hosting');
  if (needsBuild) {
    const modeArgs = rawSlug === 'bvfd' ? ['vite', 'build'] : ['vite', 'build', '--mode', rawSlug];
    console.log(`\n[1/2] Building StationSync frontend for "${dept.name}" (${dept.envFile})...`);
    runInteractive('npx', modeArgs, { BASE_PATH: '/' });
  }

  const targets = [];
  if (deployAll || parts.includes('auth') || parts.includes('rules')) {
    targets.push('auth');
  }
  if (deployAll || parts.includes('rules') || parts.includes('firestore')) {
    targets.push('firestore');
  }
  if (deployAll || parts.includes('database')) {
    targets.push('database');
  }
  if (deployAll || parts.includes('storage')) {
    targets.push('storage');
  }
  if (deployAll || parts.includes('functions')) {
    targets.push('functions');
  }
  if (deployAll || parts.includes('hosting')) {
    targets.push('hosting:default');
  }

  const onlyFlag = targets.join(',');
  console.log(`\n[2/2] Deploying [${onlyFlag}] to Firebase project "${dept.projectId}" (${dept.subdomain})...`);
  runInteractive('npx', ['firebase', 'deploy', '--project', dept.projectId, '--only', onlyFlag]);
};

const cmdDev = (positional) => {
  const rawSlug = String(positional[0] || 'demo').trim().toLowerCase();
  const registry = readJson(DEPARTMENTS_PATH, { departments: {} });
  const dept = registry.departments && registry.departments[rawSlug];
  if (!dept) {
    console.error(`Unknown department "${rawSlug}". Run "npm run dept:list" to see configured departments.`);
    process.exit(1);
  }
  console.log(`Starting Vite dev server for "${dept.name}" (mode: ${rawSlug}, env: ${dept.envFile})...`);
  const args = rawSlug === 'bvfd' ? ['vite'] : ['vite', '--mode', rawSlug];
  runInteractive('npx', args);
};

const [subcommand, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);

switch (subcommand) {
  case 'list':
    cmdList();
    break;
  case 'onboard':
    cmdOnboard(positional, flags);
    break;
  case 'deploy':
    cmdDeploy(positional, flags);
    break;
  case 'dev':
    cmdDev(positional, flags);
    break;
  default:
    console.log(
      'Usage:\n' +
        '  npm run dept:list\n' +
        '  npm run dept:onboard -- <slug> [--name "Department Name"] [--project <projectId>] [--create-project] [--demo]\n' +
        '  npm run dept:deploy  -- <slug> [--only all|hosting|rules|storage|database|functions]\n' +
        '  npm run dept:dev     -- <slug>'
    );
    process.exit(subcommand ? 1 : 0);
}

