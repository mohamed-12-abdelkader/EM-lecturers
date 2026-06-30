#!/usr/bin/env node
/**
 * Stops ngrok and the process listening on PORT (default 8000).
 * Usage: npm run dev:stop
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.development') });

const PORT = Number(process.env.PORT || 8000);

function killPortWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`✅ Stopped process PID ${pid} on port ${port}`);
      } catch {
        console.log(`⚠️  Could not stop PID ${pid}`);
      }
    }
    if (!pids.size) console.log(`ℹ️  No listener on port ${port}`);
  } catch {
    console.log(`ℹ️  No listener on port ${port}`);
  }
}

console.log('\n🛑 Stopping dev processes...\n');

if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM ngrok.exe', { stdio: 'ignore' });
    console.log('✅ Stopped ngrok.exe');
  } catch {
    console.log('ℹ️  ngrok.exe was not running');
  }
  killPortWindows(PORT);
} else {
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: 'ignore', shell: true });
    console.log(`✅ Stopped process on port ${PORT}`);
  } catch {
    console.log(`ℹ️  No listener on port ${PORT}`);
  }
  try {
    execSync('pkill -f ngrok', { stdio: 'ignore' });
    console.log('✅ Stopped ngrok');
  } catch {
    console.log('ℹ️  ngrok was not running');
  }
}

console.log('\n✅ Done. Run: npm run dev\n');
