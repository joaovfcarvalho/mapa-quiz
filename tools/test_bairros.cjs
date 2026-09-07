// Run with Playwright available in NODE_PATH; uses installed Microsoft Edge.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = require('node:http').createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (e, data) => { if (e) res.writeHead(404).end(); else { res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(data); } });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/bairros-rio.html');
    assert.equal(await page.locator('.bairro').count(), 166);
    await page.click('#btn-iniciar');
    async function guess(s) { await page.fill('#input-palpite', s); await page.press('#input-palpite', 'Enter'); }
    await guess('COPAcaBANA'); await guess('copacabana');
    assert.equal(await page.locator('.acertado').count(), 1);
    await guess('saoconrado'); await guess('São Cristóvão');
    assert.equal(await page.locator('.acertado').count(), 3);
    await guess('Freguesia'); assert.match(await page.locator('#feedback').innerText(), /Qual Freguesia/);
    await guess('Freguesia (Jacarepaguá)'); await guess('Freguesia (Ilha do Governador)');
    assert.equal(await page.locator('.acertado').count(), 5);
    await guess('Niterói'); assert.equal(await page.locator('.acertado').count(), 5);
    await page.click('#btn-dica'); assert.ok(await page.locator('#dica-atual').isVisible());
    const vb = await page.locator('#mapa').getAttribute('viewBox');
    await page.click('#btn-zoom-mais'); assert.notEqual(await page.locator('#mapa').getAttribute('viewBox'), vb);
    await page.click('#btn-encerrar'); assert.equal(await page.locator('.faltante').count(), 161);
    assert.equal(await page.locator('.relatorio li').count(), 161);
    await page.click('#btn-de-novo'); assert.ok(await page.locator('#recorde-atual').isVisible());
    await page.selectOption('#cfg-limite', 'tempo'); await page.fill('#cfg-tempo', '1');
    await page.clock.install(); await page.click('#btn-iniciar');
    await page.clock.fastForward(61000); assert.ok(await page.locator('#input-palpite').isDisabled());
    assert.match(await page.locator('#fim-jogo').innerText(), /Tempo esgotado/);
    await page.clock.resume();
    // Complete a fresh game using each dataset name, including disambiguation.
    await page.click('#btn-de-novo'); await page.selectOption('#cfg-limite', 'livre'); await page.click('#btn-iniciar');
    const names = await page.evaluate(() => BAIRROS_RIO.map(b => b.nome.startsWith('Freguesia') ? (b.ra.toLowerCase().includes('ilha') ? 'Freguesia (Ilha do Governador)' : 'Freguesia (Jacarepaguá)') : b.nome));
    for (const name of names) await guess(name);
    assert.equal(await page.locator('.acertado').count(), 166);
    assert.match(await page.locator('#fim-jogo').innerText(), /Você completou/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#btn-de-novo');
    await page.click('.outros-modos summary');
    const box = await page.locator('.outros-modos-links').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'Mobile menu stays on screen');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.outros-modos').getAttribute('open'), null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    if (process.env.SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'bairros-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 }); await page.click('#btn-iniciar');
      for (const n of ['Copacabana', 'Ipanema', 'Botafogo', 'Campo Grande', 'Tijuca', 'Santa Cruz']) await guess(n);
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'bairros-desktop.png'), fullPage: true });
    }
    await page.goto(base + '/rios.html'); await page.click('#btn-iniciar'); await guess('amazonas');
    assert.ok(await page.locator('.rio.acertado').count());
    await page.goto(base + '/index.html'); await page.click('.outros-modos summary');
    assert.equal(await page.locator('.outros-modos a').count(), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: 166 polygons, normalization, duplicates, ambiguity, invalid guesses, hints, zoom, reveal, records, timer, completion, mobile navigation and river/municipality smoke checks.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
