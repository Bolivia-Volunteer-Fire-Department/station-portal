import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'fire-clock-76723';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 6);
const POLL_INTERVAL_MS = 8000;

function getAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN;
  }
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const token = parsed?.tokens?.access_token;
  if (!token) {
    throw new Error(`No access_token found in ${configPath}. Run "firebase login" first.`);
  }
  return token;
}

async function apiFetch(url, options = {}, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const token = getAccessToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-user-project': PROJECT_ID,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (res.ok) {
      return data;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delayMs = 3000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}: ${JSON.stringify(data)}`);
  }
}

async function patchFunctionToOnDeployPolicy(fn) {
  const shortName = fn.name.split('/').pop();
  const payload = structuredClone(fn);
  delete payload.buildConfig.automaticUpdatePolicy;
  payload.buildConfig.onDeployUpdatePolicy = {};

  const mask = 'buildConfig.onDeployUpdatePolicy';
  const url = `https://cloudfunctions.googleapis.com/v2/${fn.name}?updateMask=${encodeURIComponent(mask)}`;
  const op = await apiFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return { shortName, fullName: fn.name, opName: op.name };
}

async function waitForOperations(ops) {
  const pending = new Map(ops.map((o) => [o.opName, o]));
  while (pending.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    for (const [opName, info] of Array.from(pending.entries())) {
      const opData = await apiFetch(`https://cloudfunctions.googleapis.com/v2/${opName}`);
      if (opData.done) {
        pending.delete(opName);
        if (opData.error) {
          console.error(`  [ERROR] ${info.shortName}: ${ opData.error.message || JSON.stringify(opData.error) }`);
        } else {
          console.log(`  [OK] ${info.shortName} locked to onDeployUpdatePolicy`);
        }
      }
    }
  }
}

async function main() {
  console.log(`Checking Cloud Functions (2nd Gen) in project "${PROJECT_ID}"...`);
  const listData = await apiFetch(
    `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT_ID}/locations/-/functions`,
  );
  const allFunctions = listData.functions || [];
  const toUpdate = allFunctions.filter((fn) => fn.buildConfig?.onDeployUpdatePolicy === undefined);
  const alreadyLocked = allFunctions.length - toUpdate.length;

  console.log(
    `Found ${allFunctions.length} functions (${alreadyLocked} already on onDeployUpdatePolicy, ${toUpdate.length} to update).`,
  );

  if (toUpdate.length === 0) {
    console.log('All functions are already locked to onDeployUpdatePolicy.');
    return;
  }

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toUpdate.length / BATCH_SIZE);
    console.log(
      `\nBatch ${batchNum}/${totalBatches}: updating ${batch.map((f) => f.name.split('/').pop()).join(', ')}...`,
    );

    const startedOps = [];
    for (const fn of batch) {
      const shortName = fn.name.split('/').pop();
      try {
        const op = await patchFunctionToOnDeployPolicy(fn);
        startedOps.push(op);
      } catch (err) {
        console.error(`  [ERROR] Failed to start PATCH for ${shortName}:`, err.message);
      }
    }

    if (startedOps.length > 0) {
      await waitForOperations(startedOps);
    }
  }

  console.log('\nFinished locking Cloud Functions runtime update policy to onDeployUpdatePolicy.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

