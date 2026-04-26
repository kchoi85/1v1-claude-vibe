// PostToolUse hook: runs prettier on the file that was just written/edited.
// Stays silent on success; never blocks the tool result.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FORMATTABLE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.md',
  '.yml',
  '.yaml',
]);

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const file = payload?.tool_input?.file_path;
if (!file) process.exit(0);

const ext = path.extname(file).toLowerCase();
if (!FORMATTABLE.has(ext)) process.exit(0);
if (!fs.existsSync(file)) process.exit(0);

const result = spawnSync('npx', ['--no-install', 'prettier', '--write', '--log-level=warn', file], {
  stdio: 'ignore',
  shell: true,
  cwd: path.resolve(__dirname, '..'),
});
process.exit(0);
