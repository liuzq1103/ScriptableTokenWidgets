import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), 'ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
let count = 0;
for (const file of files) {
  if (/\.(png|jpg|woff2?)$/.test(file)) continue;
  const content = await readFile(path.join(root, file), 'utf8');
  if (file.startsWith('.local/') || /(?:^|\/)\.env$/.test(file)) throw new Error('Private file selected: ' + file);
  const privatePatterns = [
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
    /\b(?:gh[opusr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/,
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  ];
  if (privatePatterns.some(pattern => pattern.test(content))) throw new Error('Possible private address or credential in ' + file);
  if (/\?{3,}/.test(content) || content.includes('\uFFFD')) throw new Error('Damaged text encoding in ' + file);
  if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  if (file.startsWith('scriptable/') && file.endsWith('.js')) new vm.Script('(async()=>{' + content + '\n})()');
  if (file.startsWith('web/') && file.endsWith('.js')) new vm.Script(content);
  count++;
}
console.log('Syntax and publication privacy checks passed for ' + count + ' text files.');
