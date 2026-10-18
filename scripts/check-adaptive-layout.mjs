// Headless fixture: never controls the user's desktop or sends translation requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  playwright = require(process.env.ARI_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || playwright.chromium.executablePath();
try { await access(executablePath); }
catch {
  const cache = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const versions = (await readdir(cache)).filter(name => name.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
  assert(versions.length, 'Install a Playwright browser or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH');
  executablePath = path.join(cache, versions[0], 'chrome-headless-shell-win64/chrome-headless-shell.exe');
}
const dist = path.join(root, 'dist');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw new Error('Outside dist');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin + '/?window=overlay');
  await page.locator('#draft').waitFor();
  assert.match(await page.locator('.game-label').textContent(),/Veylo AI/);
  assert.equal(await page.locator('#source-language').inputValue(), 'auto');
  assert.equal(await page.locator('#target-language').inputValue(), 'ru');
  assert(await page.locator('#swap-languages').isDisabled());
  assert.equal(await page.locator('#target-language option[value="auto"]').count(), 0);
  await page.locator('#draft').fill('Hallo, wo ist das Eisen?');
  await page.locator('#target-language').selectOption('en');
  assert.equal(await page.locator('#source-language').inputValue(), 'auto');
  assert.equal(await page.locator('#draft').inputValue(), '');
  await page.locator('#draft').fill('Bonjour');
  await page.locator('#target-language').selectOption('ru');
  assert.equal(await page.locator('#draft').inputValue(), 'Hallo, wo ist das Eisen?');
  await page.locator('#source-language').selectOption('sk');
  assert.equal(await page.locator('[data-display-mode]').count(), 0, 'Translator must use the pin button without the duplicate switch');
  await page.locator('#draft').fill('Ahoj — черновик');
  await page.locator('#swap-languages').click();
  assert.equal(await page.locator('#source-language').inputValue(), 'ru');
  assert.equal(await page.locator('#target-language').inputValue(), 'sk');
  await page.locator('#draft').fill('Привет — черновик');
  await page.locator('#source-language').selectOption('sk');
  assert.equal(await page.locator('#target-language').inputValue(), 'ru');
  assert.equal(await page.locator('#draft').inputValue(), 'Ahoj — черновик');
  await page.locator('#target-language').selectOption('sk');
  assert.equal(await page.locator('#source-language').inputValue(), 'ru');
  assert.equal(await page.locator('#draft').inputValue(), 'Привет — черновик');
  await page.locator('#swap-languages').click();
  // English must be selectable from either side; each pair keeps its own draft.
  await page.locator('#source-language').selectOption('en');
  assert.equal(await page.locator('#target-language').inputValue(), 'ru');
  await page.locator('#draft').fill('Where is iron?');
  await page.locator('#swap-languages').click();
  assert.equal(await page.locator('#source-language').inputValue(), 'ru');
  assert.equal(await page.locator('#target-language').inputValue(), 'en');
  await page.locator('#draft').fill('Где железо?');
  await page.locator('#source-language').selectOption('sk');
  assert.equal(await page.locator('#target-language').inputValue(), 'en');
  await page.locator('#draft').fill('Kde je železo?');
  await page.locator('#swap-languages').click();
  assert.equal(await page.locator('#source-language').inputValue(), 'en');
  assert.equal(await page.locator('#target-language').inputValue(), 'sk');
  await page.locator('#target-language').selectOption('ru');
  assert.equal(await page.locator('#draft').inputValue(), 'Where is iron?');
  assert.equal(await page.locator('.source-pane .language-tag').textContent(), 'EN');
  assert.equal(await page.locator('.result-pane .language-tag').textContent(), 'RU');
  await page.locator('#source-language').selectOption('sk');
  assert.equal(await page.locator('#draft').inputValue(), 'Ahoj — черновик');
  const draft = 'Ahoj '.repeat(100) + 'x'.repeat(300);
  await page.evaluate(text => {
    document.querySelector('#draft').value = text;
    document.querySelector('#draft').setSelectionRange(5, 12);
    const output = document.querySelector('#translation-output');
    output.className = 'translated-text'; output.textContent = 'Перевод '.repeat(150) + 'x'.repeat(300);
  }, draft);
  const measure = () => page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    const controls = ['#screen-translate', '#screen-translate-full', '#screen-translate-line', '#translate', '#copy-result', '#pin-panel', '#overlay-toggle', '#overlay-close', '#source-language', '#swap-languages', '#target-language'];
    return {
      width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      source: rect('.source-pane'), result: rect('.result-pane'), input: rect('#draft'), output: rect('#translation-output'),
      controls: controls.map(selector => {
        const element = document.querySelector(selector), r = rect(selector);
        return { selector, ...r, reachable: element.contains(document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2)) };
      }),
      edges: document.querySelectorAll('[data-resize]').length,
      draft: document.querySelector('#draft').value,
      selection: document.querySelector('#draft').selectionStart,
    };
  });
  function assertFits(m) {
    assert(!m.overflow, 'Page overflows viewport');
    for (const r of [...m.controls, m.source, m.result, m.input, m.output]) {
      assert(r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.right <= m.width + 1 && r.bottom <= m.height + 1, `Clipped element: ${JSON.stringify(r)}`);
    }
    assert(m.input.h >= 20 && m.output.h >= 20, `Text areas must remain readable: ${m.width}x${m.height}, input=${m.input.h}, output=${m.output.h}`);
    assert(m.controls.every(control => control.reachable), 'Resize edges must not cover controls');
    assert.equal(m.edges, 8);
    assert.equal(m.draft, draft, 'Resize lost the draft');
    assert.equal(m.selection, 5, 'Resize lost input selection');
  }
  await mkdir(path.join(root, '.cache/adaptive'), { recursive: true });
  const measurements = [];
  for (const [width, height] of [[320, 240], [360, 280], [360, 700], [559, 400], [560, 240], [700, 400], [900, 900]]) {
    await page.setViewportSize({ width, height });
    const m = await measure(); assertFits(m);
    if (width < 560) assert(m.result.y >= m.source.bottom - 1, 'Narrow window must stack text areas');
    else assert(m.result.x >= m.source.right - 1 && Math.abs(m.result.y - m.source.y) < 1, 'Wide window must place text areas side by side');
    measurements.push(m);
    if ([240, 700, 900].includes(height)) await page.screenshot({ path: path.join(root, `.cache/adaptive/${width}x${height}.png`) });
    console.log(`FITS ${width}x${height} input=${Math.round(m.input.h)} output=${Math.round(m.output.h)}`);
  }
  assert(measurements[2].input.h > measurements[1].input.h + 100, 'Input must grow with window height');
  assert(measurements[2].output.h > measurements[1].output.h + 100, 'Result must grow with window height');
  // Negative control: the same geometry oracle must reject actual clipping.
  await page.addStyleTag({ content: 'body[data-mode="overlay"] .source-pane { width:2000px !important; }' });
  const clipped = await measure();
  assert.throws(() => assertFits(clipped), /Clipped element/);
  await page.goto(origin + '/');
  await page.locator('#content .overlay-settings').waitFor();
  assert.equal(await page.locator('[data-resize]').count(), 0, 'Main window must not receive overlay resize edges');
  // Exercise the actual production capture UI against an in-memory IPC fixture.
  // No desktop capture, native inputs or network translation are used.
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.isTauri = true;
    const callbacks = new Map(), events = new Map(); let next = 1;
    window.mockCalls = [];
    window.mockHotkeys = {ready:!location.search.includes("window=main"),revision:0,bindings:[{action:'overlay',key:'Ctrl + Shift + Space',registered:true,error:null},{action:'screen',key:'Alt + Q',registered:true,error:null},{action:'area',key:'Alt + E',registered:true,error:null},{action:'cursor',key:'Alt + W',registered:true,error:null}],error:null};
    window.mockHistory={revision:1,enabled:true,error:null,entries:[{id:1,createdAtMs:1000,mode:'text',direction:'auto-ru',source:'Ahoj',translation:'Привет',elapsedMs:20},{id:2,createdAtMs:2000,mode:'cursor',direction:'auto-ru',source:'<img src=x onerror=alert(1)> Find iron',translation:'Найди железо',elapsedMs:30}]};
    window.mockGeneration = 1;
    window.mockEmit = (name, payload) => {
      if (name === 'screen-capture-state' && payload.generation !== undefined) window.mockGeneration = Math.max(window.mockGeneration, payload.generation);
      for (const id of events.get(name) || []) callbacks.get(id)?.({ event: name, id, payload });
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: location.pathname.includes('backdrop') ? 'backdrop' : new URLSearchParams(location.search).get('window')==='main' ? 'main' : 'overlay' } },
      transformCallback: callback => { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback: id => callbacks.delete(id),
      invoke: async (command, args) => {
        window.mockCalls.push({ command, args });
        if (command === 'plugin:event|listen') { events.set(args.event, [...(events.get(args.event) || []), args.handler]); return next++; }
        if (command === 'screen_capture_status') return { phase: location.pathname.includes('backdrop') ? 'selecting' : 'idle', busy: location.pathname.includes('backdrop'), generation: 1, error: null };
        if (command === 'screen_capture_frame') {
          if (window.mockDelayFrame) return await new Promise((_, reject) => { window.mockRejectFrame = reject; });
          const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 800;
          const draw = canvas.getContext('2d'); draw.fillStyle = '#445f5a'; draw.fillRect(0, 0, 1000, 800);
          draw.fillStyle = '#202c28'; draw.fillRect(0, 400, 1000, 400);
          draw.fillStyle = '#000a'; draw.fillRect(100, 200, 700, 400);
          draw.fillStyle = '#d9f4de'; draw.font = '22px monospace'; draw.fillText('Play', 120, 240); draw.fillText('Where can I find iron?', 120, 320);
          return { generation: window.mockGeneration, image: canvas.toDataURL() };
        }
        if (command === 'cancel_screen_capture') window.mockEmit('screen-capture-state', { phase: 'idle', busy: false, generation: window.mockGeneration + 1, error: null });
        if (command === 'finish_screen_capture') {
          window.mockEmit('screen-capture-state', { phase: 'translating', busy: true, generation: window.mockGeneration, region: args.region, error: null });
          await new Promise(resolve => setTimeout(resolve, 20));
          window.mockEmit('screen-capture-state', { phase: 'result', busy: false, generation: window.mockGeneration, region: args.region, translated: 'Привет! Где найти железо?\nИгрок: куплю золотые зачарованные яблоки.\nИгрок: продаю предметы.', error: null });
          window.mockFinished = true;
        }
        if (command === 'overlay_view') return { pinned: true, visible: true, editing: false, width: 360, height: 280, ready: true, openError: null, saveError: null };
        if (command === 'translation_snapshot') return { revision: 0, busy: false, entries: [null, null] };
        if (command === 'get_hotkeys') return structuredClone(window.mockHotkeys);
        if (command === 'history_action') {
          const action=args.action; let exportPath=null;
          if(action.type==='setEnabled')window.mockHistory.enabled=action.enabled;
          if(action.type==='remove')window.mockHistory.entries=window.mockHistory.entries.filter(entry=>entry.id!==action.id);
          if(action.type==='clear')window.mockHistory.entries=[];
          if(action.type==='export')exportPath='/Downloads/Veylo AI/translation-history-test.json';
          if(action.type!=='read')window.mockHistory.revision++;
          return {snapshot:structuredClone(window.mockHistory),exportPath};
        }
        if(command==='copy_text')return;
        if (command === 'set_hotkey_recording') {window.mockRecording=args.recording;return;}
        if (command === 'set_hotkey') {
          if(args.key==='Alt + Q') throw new Error('Комбинация занята. Прежняя оставлена.');
          window.mockHotkeys.bindings.find(binding=>binding.action===args.action).key=args.key;window.mockHotkeys.revision++;return structuredClone(window.mockHotkeys);
        }
        if (command === 'translate_text') return { text: 'Привет, где железо?', direction: args.direction, elapsedMs: 10 };
        if (command === 'get_app_status') return { shortcutPending: false, shortcutRegistered: true, shortcut: 'Ctrl + Shift + Space' };
        return null;
      },
    };
    // Synthetic pointer fixtures have no operating-system pointer capture.
    HTMLElement.prototype.setPointerCapture = () => {};
    HTMLElement.prototype.hasPointerCapture = () => false;
  });
  const capturePage = await context.newPage();
  await capturePage.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await capturePage.setViewportSize({ width: 1000, height: 800 });
  await capturePage.goto(origin + '/backdrop.html');
  await capturePage.locator('#capture-surface').waitFor({ state: 'visible' });
  await capturePage.waitForFunction(() => document.querySelector('#frozen-frame').complete && document.querySelector('#frozen-frame').naturalWidth > 0);
  await capturePage.evaluate(() => {
    const surface = document.querySelector('#capture-surface');
    for (const [type, x, y] of [['pointerdown', 800, 600], ['pointermove', 100, 200], ['pointerup', 100, 200]]) {
      surface.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
    }
  });
  // Completing a selection produces a browser click after pointerup. It must
  // not immediately dismiss the newly opened translation.
  await capturePage.evaluate(() => document.querySelector('#capture-surface').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await capturePage.locator('#capture-surface').waitFor({ state: 'hidden' });
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'finish_screen_capture'));
  await capturePage.waitForFunction(() => window.mockFinished === true);
  const crop = await capturePage.evaluate(() => window.mockCalls.find(c => c.command === 'finish_screen_capture').args.region);
  assert.deepEqual(crop, { left: .1, top: .25, right: .8, bottom: .75 });
  assert.equal(await capturePage.locator('#inplace-result').isVisible(), true);
  assert.match(await capturePage.locator('#inplace-text').textContent(), /Где найти железо/);
  const placed = await capturePage.locator('#inplace-result').boundingBox();
  assert(Math.abs(placed.x - 100) < 1 && Math.abs(placed.y - 200) < 1 && Math.abs(placed.width - 700) < 1 && Math.abs(placed.height - 400) < 1);
  assert.equal(await capturePage.evaluate(() => document.body.dataset.frozen), 'true');
  assert(!await capturePage.evaluate(() => window.mockCalls.some(c => c.command === 'cancel_screen_capture')), 'Selection mouseup must not dismiss its own result');
  await capturePage.screenshot({ path: path.join(root, '.cache/adaptive/inplace-result.png') });
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'result', generation: 1, busy: false, region: { left: .99, top: .99, right: 1, bottom: 1 }, translated: '<img src=x onerror=alert(1)>\n'.repeat(300), error: null }));
  const edgeResult = await capturePage.locator('#inplace-result').boundingBox();
  assert(edgeResult.x + edgeResult.width <= 1001 && edgeResult.y + edgeResult.height <= 801);
  assert.equal(await capturePage.locator('#inplace-text img').count(), 0, 'Image text is data, never HTML');
  assert(await capturePage.evaluate(() => { const text = document.querySelector('#inplace-text'); return text.scrollHeight > text.clientHeight && document.documentElement.scrollHeight <= innerHeight; }), 'Long result must scroll inside the chat overlay');
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'result', generation: 1, busy: false, region: { left: 0, top: 0, right: 1, bottom: 1 }, translated: 'Перевод всего экрана\n'.repeat(250), error: null }));
  const fullResult = await capturePage.locator('#inplace-result').boundingBox();
  assert(fullResult.width <= 760 && fullResult.height <= 800 && fullResult.x > 0 && fullResult.y > 0);
  assert.equal(await capturePage.locator('#inplace-text').evaluate(el => getComputedStyle(el).fontSize), '18px');
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', {phase:'error',generation:1,busy:false,region:{left:0,top:0,right:1,bottom:1},error:'Текст уже на русском — перевод не нужен.'}));
  assert.equal(await capturePage.locator('#inplace-result').getAttribute('data-phase'),'notice');
  const noticeBounds=await capturePage.locator('#inplace-result').boundingBox();
  assert(noticeBounds.width<=560 && noticeBounds.height<180 && noticeBounds.x>0);
  await capturePage.screenshot({path:path.join(root,'.cache/adaptive/already-russian-notice.png')});
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', {phase:'error',generation:1,busy:false,region:{left:0,top:0,right:1,bottom:1},error:'Не удалось прочитать текст. Попробуй выделить область точнее.'}));
  assert.equal(await capturePage.locator('#inplace-result').getAttribute('data-phase'),'error');
  const errorBounds=await capturePage.locator('#inplace-result').boundingBox();
  assert(errorBounds.width<=560 && errorBounds.height<180);
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'result', generation: 1, busy: false, region: { left: 0, top: 0, right: 1, bottom: 1 }, translated: 'Перевод всего экрана\n'.repeat(250), error: null }));
  assert.equal(await capturePage.locator('#capture-surface').isVisible(), false, 'Full screen result must not require a selection');
  assert(await capturePage.evaluate(() => { const text = document.querySelector('#inplace-text'); return text.scrollHeight > text.clientHeight; }));
  await capturePage.screenshot({ path: path.join(root, '.cache/adaptive/full-screen-result.png') });
  // Cursor context must use the same full-monitor scene and progress as full screen.
  const pendingBounds = [];
  for (const region of [{left:0,top:0,right:1,bottom:1}, {left:.1,top:.4,right:.9,bottom:.6}]) {
    await capturePage.evaluate(region => window.mockEmit('screen-capture-state', {phase:'translating',generation:1,busy:true,region,error:null}), region);
    assert.equal(await capturePage.locator('#inplace-result').isVisible(), false);
    assert.equal(await capturePage.locator('#capture-surface').isVisible(), false);
    assert.equal(await capturePage.locator('#frozen-frame').isVisible(), true);
    const frameBounds = await capturePage.locator('#frozen-frame').boundingBox();
    assert.deepEqual(frameBounds, {x:0,y:0,width:1000,height:800});
    const bounds = await capturePage.locator('#capture-progress').boundingBox();
    assert(bounds && Math.abs(bounds.x + bounds.width / 2 - 500) < 1 && Math.abs(bounds.y + bounds.height / 2 - 400) < 1);
    pendingBounds.push(bounds);
  }
  assert.deepEqual(pendingBounds[0], pendingBounds[1], 'Line and full screen share the same progress placement');
  await capturePage.screenshot({path:path.join(root,'.cache/adaptive/line-fullscreen-progress.png')});
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', {
    phase:'result',generation:1,busy:false,region:{left:0,top:0,right:1,bottom:1},translated:'Играть\nНайти железо',error:null,
    blocks:[
      {region:{left:.12,top:.26,right:.35,bottom:.31},source:'Play',translation:'Играть'},
      {region:{left:.12,top:.36,right:.55,bottom:.47},source:'Where can I find iron?',translation:'Где можно найти железо?'}
    ]
  }));
  assert.equal(await capturePage.locator('.translated-block').count(),2);
  assert.equal(await capturePage.locator('#capture-progress').isVisible(),false);
  assert.equal(await capturePage.locator('#inplace-result').isVisible(),false,'Spatial blocks replace the combined panel');
  const firstBlock = await capturePage.locator('.translated-block').first().boundingBox();
  assert(firstBlock.x <= 120 && firstBlock.y <= 208 && firstBlock.x + firstBlock.width >= 350);
  assert.equal(await capturePage.locator('.translated-block').first().getAttribute('title'),'Play');
  await capturePage.locator('.translated-block').first().click();
  assert.equal(await capturePage.locator('#translation-blocks').isVisible(),true,'Selecting a block must not dismiss the scene');
  await capturePage.screenshot({ path:path.join(root,'.cache/adaptive/spatial-blocks.png') });
  await capturePage.locator('#toggle-original').click();
  assert.equal(await capturePage.locator('#translation-blocks').isVisible(),false);
  assert.equal(await capturePage.locator('#frozen-frame').isVisible(),true);
  await capturePage.locator('#toggle-original').click();
  assert.equal(await capturePage.locator('.translated-block').count(),2);
  const lineBounds = [];
  for (const region of [{left:0,top:0,right:1,bottom:1}, {left:.1,top:.2,right:.8,bottom:.5}]) {
    await capturePage.evaluate(region => window.mockEmit('screen-capture-state', {phase:'result',generation:1,busy:false,region,error:null,blocks:[{region:{left:.12,top:.36,right:.55,bottom:.40},source:'Where can I find iron?',translation:'Где найти железо?'}]}), region);
    assert.equal(await capturePage.locator('.translated-block').count(),1);
    assert.equal(await capturePage.locator('#inplace-result').isVisible(),false);
    lineBounds.push(await capturePage.locator('.translated-block').boundingBox());
  }
  assert.deepEqual(lineBounds[0],lineBounds[1],'Line and full screen place the same text at the same coordinates');
  await capturePage.screenshot({path:path.join(root,'.cache/adaptive/line-fullscreen-result.png')});
  if (process.argv.includes('--record-render') || process.argv.includes('--compare-render')) {
    const benchmark = await capturePage.evaluate(() => {
      const blocks=Array.from({length:80},(_,i)=>({region:{left:(i%8)/8,top:Math.floor(i/8)/10,right:(i%8+.95)/8,bottom:(Math.floor(i/8)+.95)/10},source:'Find iron',translation:'Найди железо возле старой пещеры и вернись в деревню.'}));
      const times=[];
      for(let run=0;run<7;run++) {
        const started=performance.now();
        window.mockEmit('screen-capture-state',{phase:'result',generation:1,busy:false,region:{left:0,top:0,right:1,bottom:1},blocks:blocks.map((block,i)=>({...block,translation:block.translation+String(run+i)})),error:null});
        document.querySelector('#translation-blocks').getBoundingClientRect();
        if(run>0) times.push(performance.now()-started);
      }
      const first=document.querySelector('.translated-block');
      const started=performance.now();
      for(let i=0;i<20;i++) {document.querySelector('#toggle-original').click();document.querySelector('#translation-blocks').getBoundingClientRect();}
      const toggleMs=performance.now()-started;
      times.sort((a,b)=>a-b);
      return {renderMedianMs:times[Math.floor(times.length/2)],toggleMs,sameNode:first===document.querySelector('.translated-block'),blocks:document.querySelectorAll('.translated-block').length};
    });
    assert.equal(benchmark.blocks,80);
    const file=path.join(root,'.cache/render-before.json');
    if(process.argv.includes('--record-render')) {await writeFile(file,JSON.stringify(benchmark,null,2));console.log('RENDER_BASELINE',JSON.stringify(benchmark));}
    else {
      const before=JSON.parse(await readFile(file,'utf8'));
      assert.equal(before.sameNode,false,'Baseline must exercise old rebuild path');
      assert.equal(benchmark.sameNode,true,'Original toggle must preserve translated nodes');
      assert(benchmark.renderMedianMs<before.renderMedianMs,'80-block render must improve over the local baseline');
      assert(benchmark.toggleMs<before.toggleMs,'Toggle must improve over the local baseline');
      await writeFile(path.join(root,'.cache/render-after.json'),JSON.stringify(benchmark,null,2));
      console.log('RENDER_PERFORMANCE_OK',JSON.stringify({before,after:benchmark}));
    }
  }
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', {phase:'result',generation:1,busy:false,region:{left:0,top:0,right:1,bottom:1},error:null,blocks:[{region:{left:.99,top:.99,right:1,bottom:1},source:'x',translation:'<img src=x onerror=alert(1)>'.repeat(100)}]}));
  assert.equal(await capturePage.locator('.translated-block img').count(),0);
  const edgeBlock = await capturePage.locator('.translated-block').boundingBox();
  assert(edgeBlock.x + edgeBlock.width <= 1000 && edgeBlock.y + edgeBlock.height <= 800);
  await capturePage.waitForFunction(() => document.body.dataset.capture === 'false');
  await capturePage.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert(await capturePage.evaluate(() => window.mockCalls.some(c => c.command === 'cancel_screen_capture')));
  assert.equal(await capturePage.locator('#frozen-frame').isVisible(), false);
  assert.equal(await capturePage.locator('#inplace-result').isVisible(), false);
  assert.equal(await capturePage.locator('.translated-block').count(),0,'Esc clears translated blocks');
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'result', generation: 1, busy: false, region: { left: .1, top: .25, right: .8, bottom: .75 }, translated: 'Stale result', error: null }));
  assert.equal(await capturePage.locator('#inplace-result').isVisible(), false, 'Late cancelled result must stay hidden');
  await capturePage.evaluate(() => {
    window.mockDelayFrame = true;
    window.mockEmit('screen-capture-state', { phase: 'selecting', busy: true, generation: 3, error: null });
  });
  await capturePage.waitForFunction(() => typeof window.mockRejectFrame === 'function');
  await capturePage.evaluate(() => {
    window.mockEmit('screen-capture-state', { phase: 'idle', busy: false, generation: 4, error: null });
    window.mockRejectFrame(new Error('Cancelled frame load'));
    document.querySelector('#frozen-frame').dispatchEvent(new Event('error'));
  });
  assert.equal(await capturePage.locator('#backdrop-error').isVisible(), false, 'Late frame errors must not leak into normal overlay mode');
  await capturePage.evaluate(() => document.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'dismiss_overlay'));
  await capturePage.goto(origin + '/?window=overlay');
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'frontend_ready'));
  await capturePage.locator('#draft').fill('Wo finde ich Eisen?');
  await capturePage.locator('#translate').click();
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'translate_text'));
  const autoRequest = await capturePage.evaluate(() => window.mockCalls.find(c => c.command === 'translate_text'));
  assert.equal(autoRequest.args.direction, 'auto-ru');
  assert.equal(autoRequest.args.text, 'Wo finde ich Eisen?');
  await capturePage.locator('#screen-translate-line').waitFor({state:'visible'});
  await capturePage.waitForFunction(() => !document.querySelector('#screen-translate-line').disabled);
  await capturePage.locator('#screen-translate-line').click();
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'start_cursor_line'));
  assert.match(await capturePage.locator('#toast').textContent(), /2 секунды/);
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', {phase:'idle',busy:false,error:null}));
  await capturePage.locator('#screen-translate-full').click();
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'start_screen_capture' && c.args.fullScreen === true));
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'idle', busy: false, error: null }));
  await capturePage.locator('#screen-translate').click();
  await capturePage.waitForFunction(() => window.mockCalls.some(c => c.command === 'start_screen_capture' && c.args.fullScreen === false));
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'translating', error: null }));
  assert.match(await capturePage.locator('#translation-output').textContent(), /снимок/);
  assert(await capturePage.locator('#screen-translate').isDisabled());
  assert(await capturePage.locator('#screen-translate-full').isDisabled());
  assert(await capturePage.locator('#screen-translate-line').isDisabled());
  await capturePage.evaluate(() => {
    window.mockEmit('screen-capture-state', { phase: 'idle', error: null });
    window.mockEmit('screen-result', { source: 'Ahoj kde je zelezo', translation: { text: 'Привет, где железо?', direction: 'auto-ru', elapsedMs: 10 } });
  });
  await capturePage.locator('#translation-output').filter({ hasText: 'Привет, где железо?' }).waitFor();
  assert.equal(await capturePage.locator('#draft').inputValue(), 'Ahoj kde je zelezo');
  assert.equal(await capturePage.locator('#source-language').inputValue(), 'auto');
  const requests = await capturePage.evaluate(() => window.mockCalls.filter(c => c.command === 'translate_text'));
  assert.equal(requests.length, 1, 'Vision result must not trigger a second text request');
  await capturePage.evaluate(() => window.mockEmit('screen-capture-state', { phase: 'idle', error: 'Текст не найден' }));
  assert.equal(await capturePage.locator('#draft').inputValue(), 'Ahoj kde je zelezo');
  assert.match(await capturePage.locator('#toast').textContent(), /Текст не найден/);
  const settingsPage=await context.newPage();
  await settingsPage.goto(origin+'/?window=main');
  await settingsPage.locator('[data-bind-action="overlay"]').waitFor();
  assert.match(await settingsPage.locator('.game-label').textContent(),/Veylo AI/);
  assert.match(await settingsPage.locator('.session-tag').textContent(),/AI-помощник/);
  await settingsPage.waitForFunction(()=>window.mockCalls.some(call=>call.command==='get_hotkeys'));
  assert.equal(await settingsPage.locator('[data-bind-action="overlay"]').isDisabled(),true);
  assert.equal(await settingsPage.locator('#hotkey-settings .open-error').count(),0,'Pending startup is not a registration failure');
  await settingsPage.evaluate(()=>{
    window.mockHotkeys.ready=true;window.mockHotkeys.revision=1;
    window.mockHotkeys.bindings.find(binding=>binding.action==='overlay').key='F9';
    window.mockEmit('hotkeys-changed',structuredClone(window.mockHotkeys));
  });
  await settingsPage.waitForFunction(()=>!document.querySelector('[data-bind-action="overlay"]').disabled);
  assert.equal(await settingsPage.locator('[data-bind-action="overlay"]').textContent(),'F9','Loaded custom binding replaces initial defaults');
  await settingsPage.evaluate(()=>window.mockEmit('hotkeys-changed',{ready:false,revision:0,bindings:[],error:null}));
  assert.equal(await settingsPage.locator('[data-bind-action="overlay"]').textContent(),'F9','Late startup snapshot cannot replace registered bindings');
  assert.equal(await settingsPage.locator('[data-bind-action]').count(),4);
  await settingsPage.locator('[data-bind-action="area"]').click();
  await settingsPage.waitForFunction(()=>window.mockRecording===true);
  await settingsPage.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR',key:'к',ctrlKey:true,altKey:true,bubbles:true,cancelable:true})));
  await settingsPage.waitForFunction(()=>document.querySelector('[data-bind-action="area"]').textContent==='Ctrl + Alt + R');
  const changed=await settingsPage.evaluate(()=>window.mockCalls.find(call=>call.command==='set_hotkey'));
  assert.deepEqual(changed.args,{action:'area',key:'Ctrl + Alt + R'});
  await settingsPage.locator('[data-bind-action="area"]').click();
  await settingsPage.waitForFunction(()=>window.mockRecording===true);
  await settingsPage.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true,cancelable:true})));
  await settingsPage.waitForFunction(()=>window.mockRecording===false);
  assert.equal(await settingsPage.evaluate(()=>window.mockCalls.filter(call=>call.command==='set_hotkey').length),1);
  await settingsPage.locator('[data-bind-action="area"]').click();
  await settingsPage.waitForFunction(()=>window.mockRecording===true);
  await settingsPage.evaluate(()=>window.mockEmit('hotkey-recorded','Alt + Q'));
  await settingsPage.locator('#hotkey-message').filter({hasText:'занята'}).waitFor();
  assert.equal(await settingsPage.locator('[data-bind-action="area"]').textContent(),'Ctrl + Alt + R');
  await settingsPage.locator('[data-reset-action="area"]').click();
  await settingsPage.waitForFunction(()=>document.querySelector('[data-bind-action="area"]').textContent==='Alt + E');
  await settingsPage.evaluate(()=>{
    window.mockEmit('hotkeys-changed',{...structuredClone(window.mockHotkeys),revision:window.mockHotkeys.revision-1,bindings:[]});
  });
  assert.equal(await settingsPage.locator('[data-bind-action="area"]').textContent(),'Alt + E','Late response cannot replace saved binding');
  await settingsPage.screenshot({path:path.join(root,'.cache/adaptive/hotkey-settings.png')});
  await settingsPage.locator('[data-section="history"]').click();
  await settingsPage.locator('[data-history-id="2"]').waitFor();
  assert.equal(await settingsPage.locator('.history-card').count(),2);
  assert.equal(await settingsPage.locator('.history-card img').count(),0,'History source remains inert text');
  await settingsPage.locator('#history-search').fill('жЕлЕЗо');
  await settingsPage.waitForFunction(()=>document.querySelectorAll('.history-card').length===1);
  await settingsPage.locator('[data-history-copy="translation"]').click();
  const copied=await settingsPage.evaluate(()=>window.mockCalls.findLast(call=>call.command==='copy_text'));
  assert.equal(copied.args.text,'Найди железо');
  await settingsPage.locator('#history-export').click();
  await settingsPage.locator('#history-message').filter({hasText:'Сохранено:'}).waitFor();
  await settingsPage.locator('#history-enabled').uncheck();
  await settingsPage.waitForFunction(()=>window.mockHistory.enabled===false);
  await settingsPage.locator('#history-search').fill('');
  await settingsPage.waitForFunction(()=>document.querySelectorAll('.history-card').length===2);
  await settingsPage.screenshot({path:path.join(root,'.cache/adaptive/history.png')});
  await settingsPage.locator('[data-history-remove="2"]').click();
  await settingsPage.waitForFunction(()=>document.querySelectorAll('.history-card').length===1);
  await settingsPage.locator('#history-clear').click();
  assert.equal(await settingsPage.locator('.history-card').count(),1,'Clear requires a second explicit click');
  await settingsPage.locator('#history-clear').click();
  await settingsPage.waitForFunction(()=>document.querySelectorAll('.history-card').length===0);
  await context.close();
  console.log('SCREEN_UI_FLOW_OK (frozen frame, in-place bounds, selection click suppression, Esc, stale result, direct image without second request)');
  console.log('ADAPTIVE_LAYOUT_OK');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
