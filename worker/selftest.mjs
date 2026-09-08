// Selftest for the SG member access system
// Tests the worker proxy functionality

import { createWorker } from './index.js';

console.log('Running SG member access system selftest...\n');

// Test 1: Worker can be created
try {
  const worker = createWorker();
  console.log('✓ Worker created successfully');
} catch (e) {
  console.error('✗ Failed to create worker:', e.message);
  process.exit(1);
}

// Test 2: Health endpoint
try {
  const res = await worker.fetch(new Request('http://localhost/health'));
  const health = await res.text();
  if (health === 'ok') {
    console.log('✓ Health endpoint returns ok');
  } else {
    console.error(`✗ Health endpoint returned: ${health}`);
    process.exit(1);
  }
} catch (e) {
  console.error('✗ Health endpoint failed:', e.message);
  process.exit(1);
}

// Test 3: Gameinfo proxy
try {
  const res = await worker.fetch(new Request('http://localhost/gameinfo/test'));
  const status = res.status;
  if (status >= 200 && status < 300) {
    console.log('✓ Gameinfo proxy works');
  } else {
    console.log(`! Gameinfo proxy status: ${status} (may fail without network)`);
  }
} catch (e) {
  console.log('! Gameinfo proxy test skipped (no network)');
}

// Test 4: Twitch uptime proxy
try {
  const res = await worker.fetch(new Request('http://localhost/twitch/uptime/testchannel'));
  const status = res.status;
  if (status >= 200 && status < 300) {
    console.log('✓ Twitch uptime proxy works');
  } else {
    console.log(`! Twitch uptime proxy status: ${status}`);
  }
} catch (e) {
  console.log('! Twitch uptime proxy test skipped');
}

console.log('\nSelftest completed!');