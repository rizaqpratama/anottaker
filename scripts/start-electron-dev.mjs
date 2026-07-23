import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const child = spawn(electron, ['electron/main.cjs'], {
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to start Electron:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
