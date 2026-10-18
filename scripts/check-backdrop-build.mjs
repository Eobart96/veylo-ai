import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
function pageStyles(page) {
  const html = readFileSync(path.join(dist, page), 'utf8');
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(link => /rel="stylesheet"/.test(link));
  assert(links.length > 0, `${page} must link its CSS directly in HTML`);
  return links.map(link => {
    const href = /href="([^"]+)"/.exec(link)?.[1];
    assert(href && !href.includes('..') && !href.includes('://'), 'local stylesheet required');
    return readFileSync(path.join(dist, href.replace(/^\//, '')), 'utf8');
  }).join('\n');
}
function assertBackdrop(css) {
  assert(css.includes('.return-to-game'), 'backdrop HUD stylesheet is missing');
  assert(css.includes('radial-gradient('), 'translucent backdrop gradients are missing');
  assert(!css.includes('.sidebar'), 'main application CSS must never reach backdrop');
  assert(/background:transparent/.test(css), 'transparent page base is required');
}
const main = pageStyles('index.html');
const backdrop = pageStyles('backdrop.html');
assert(main.includes('.sidebar'), 'positive control: main CSS is loaded by main page');
// Reproduce the previous contamination as a negative control.
assert.throws(() => assertBackdrop(main), /backdrop HUD/);
assert.throws(() => assertBackdrop(`${backdrop}\n${main}`), /main application CSS/);
assertBackdrop(backdrop);
assert(!main.includes('.return-to-game'), 'backdrop CSS must not leak into main');
const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const window = config.app.windows.find(window => window.label === 'backdrop');
assert.equal(window.url, 'backdrop.html');
assert.equal(window.transparent, true);
assert.equal(window.backgroundColor, '#00000000');
console.log('BACKDROP_ASSETS_OK (static stylesheets isolated; contamination controls rejected)');
