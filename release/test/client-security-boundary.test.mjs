import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.dirname(releaseRoot);

async function collectSourceFiles(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(absolute, output);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

test('untrusted external destinations are reduced to credential-free HTTPS URLs', async () => {
  const securityModuleUrl = pathToFileURL(
    path.join(sourceRoot, 'apps/mobile/src/security/externalUrls.mjs'),
  ).href;
  const { isSameOriginUrl, normalizeExternalHttpsUrl, normalizeTelegramPostReference } = await import(securityModuleUrl);

  assert.equal(normalizeExternalHttpsUrl(' https://example.com/path?q=1 '), 'https://example.com/path?q=1');
  assert.equal(normalizeExternalHttpsUrl('http://example.com/path'), null);
  assert.equal(normalizeExternalHttpsUrl('javascript:alert(1)'), null);
  assert.equal(normalizeExternalHttpsUrl('data:text/html,hello'), null);
  assert.equal(normalizeExternalHttpsUrl('https://user:secret@example.com/path'), null);
  assert.equal(normalizeExternalHttpsUrl('https://example.com/path', ['example.com']), 'https://example.com/path');
  assert.equal(normalizeExternalHttpsUrl('https://example.com.evil/path', ['example.com']), null);
  assert.equal(isSameOriginUrl('https://volna.social/api/me', 'https://volna.social'), true);
  assert.equal(isSameOriginUrl('https://volna.social.evil/api/me', 'https://volna.social'), false);

  assert.deepEqual(normalizeTelegramPostReference('volna_social', '12345'), {
    channelUsername: 'volna_social',
    messageId: '12345',
  });
  assert.equal(normalizeTelegramPostReference('bad\" onload=\"alert(1)', '12345'), null);
  assert.equal(normalizeTelegramPostReference('volna_social', '1/../../evil'), null);
});

test('the native bearer-token boundary compares parsed origins, not string prefixes', async () => {
  const source = await readFile(path.join(sourceRoot, 'apps/mobile/src/api/client.ts'), 'utf8');
  assert.doesNotMatch(source, /url\.startsWith\(apiUrl\)/);
  assert.match(source, /isSameOriginUrl\(url, apiUrl\)/);
});

test('mobile OS navigation is centralized behind the HTTPS policy', async () => {
  const mobileSourceRoot = path.join(sourceRoot, 'apps/mobile/src');
  for (const file of await collectSourceFiles(mobileSourceRoot)) {
    const relative = path.relative(mobileSourceRoot, file).replaceAll('\\', '/');
    if (relative === 'security/openExternalUrl.ts') continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /Linking\.openURL\s*\(/, `direct OS navigation in ${relative}`);
  }
});

test('public E2EE claims distinguish MLS threads from server-readable legacy chats', async () => {
  const architecture = await readFile(path.join(releaseRoot, 'ARCHITECTURE.md'), 'utf8');
  const security = await readFile(path.join(releaseRoot, 'SECURITY.md'), 'utf8');

  for (const document of [architecture, security]) {
    assert.match(document, /legacy (?:conversation|chat)s? remain server-readable/i);
  }
  assert.doesNotMatch(architecture, /^The API never receives message plaintext/m);
});
