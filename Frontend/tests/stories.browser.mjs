import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const output = '.local-run/browser-verification';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], failedAssets = [], results = [];
let testingFailure = false;
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (!testingFailure && response.url().includes('/case-studies/') && response.status() >= 400) failedAssets.push({ url: response.url(), status: response.status() }); });
try {
  await page.goto(process.env.STORIES_BASE_URL ?? 'http://127.0.0.1:5180', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await page.locator('.story-card').first().waitFor();
  for (const location of ['bangalore', 'jeddah']) {
    const story = JSON.parse(await readFile(`Frontend/public/case-studies/${location}-sequence-2026/result.json`, 'utf8'));
    const imageSizes = new Set();
    for (const frame of story.observations) {
      const content = await readFile(`Frontend/public/case-studies/${story.slug}/${frame.image}`);
      assert.equal(createHash('sha256').update(content).digest('hex'), frame.imageSha256);
      imageSizes.add(`${content.readUInt32BE(16)}x${content.readUInt32BE(20)}`);
    }
    assert.equal(imageSizes.size, 1, 'Story frames must have identical dimensions');
    await page.locator('.story-card').filter({ hasText: story.title }).click();
    await page.getByRole('region', { name: 'Observation sequence' }).waitFor();
    assert.equal(await page.locator('.story-sequence-stop').count(), 5);
    assert.equal(await page.getByRole('button', { name: 'Previous observation', exact: true }).isDisabled(), true);
    for (let index = 0; index < 5; index++) {
      const observation = story.observations[index];
      await page.getByRole('button', { name: `Frame ${index + 1}: ${observation.date.slice(0, 10)}`, exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.story-sequence-images img')].every(img => img.complete && img.naturalWidth > 0));
      assert.match(await page.locator('.story-sequence-images img').last().getAttribute('src'), new RegExp(`frame-${index + 1}\\.png$`));
      assert.match(await page.locator('.story-panel-heading').innerText(), new RegExp(`Observation ${index + 1} of 5`, 'i'));
      assert.equal(await page.locator('.story-sequence-caption').innerText(), observation.caption);
      assert.match(await page.locator('.story-sequence-legend').innerText(), /-30 dB/);
      assert.match(await page.locator('.story-sequence-legend').innerText(), /5 dB/);
    }
    assert.equal(await page.getByRole('button', { name: 'Next observation', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Previous observation', exact: true }).click();
    assert.match(await page.locator('.story-panel-heading').innerText(), /Observation 4 of 5/i);
    await page.getByRole('button', { name: 'Next observation', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Show first observation alongside' }).check();
    assert.equal(await page.locator('.story-sequence-images img').count(), 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.story-sequence-images img')].every(img => img.complete && img.naturalWidth > 0));
    assert.match(await page.locator('.story-sequence-images img').first().getAttribute('src'), /frame-1\.png$/);
    await page.locator('.story-sequence-images').screenshot({ path: `${output}/${location}-comparison.png` });
    await page.getByText('Acquisition and processing details', { exact: true }).click();
    assert.match(await page.locator('.story-provenance').innerText(), new RegExp(story.observations[4].productId));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.story-sequence-stop').first().focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.story-panel-heading').innerText(), /Observation 1 of 5/i);
    assert.equal(await page.locator('.stories-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'Story overflows narrow screen');
    assert.equal(await page.locator('.wordmark').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.top-navigation').getBoundingClientRect().bottom), true, 'Logo overflows mobile header');
    await page.locator('.stories-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${output}/${location}-mobile.png` });
    await page.getByRole('button', { name: 'All stories', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    results.push({ location, frames: 5, dates: story.observations.map(o => o.date.slice(0, 10)), checks: ['catalog entry', 'all frames load', 'captions and dates', 'fixed legend', 'previous/next boundaries', 'baseline comparison', 'provenance', 'keyboard selection', '390px layout'] });
  }
  await page.locator('.story-card').filter({ hasText: 'Indus River flood near Sukkur' }).click();
  await page.getByRole('button', { name: 'Water map', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Radar difference', exact: true }).click();
  await page.waitForFunction(() => { const img = document.querySelector('.story-map img'); return img?.complete && img.naturalWidth > 0; });
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await page.getByRole('button', { name: 'Stories', exact: true }).waitFor();
  testingFailure = true;
  await page.getByRole('button', { name: 'Stories', exact: true }).click();
  await page.route('**/bangalore-sequence-2026/result.json', route => route.fulfill({ status: 404, body: '{}' }));
  await page.locator('.story-card').filter({ hasText: 'Bangalore: five views of a lake corridor' }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not load this story.' }).waitFor();
  await page.unroute('**/bangalore-sequence-2026/result.json');
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await page.route('**/bangalore-sequence-2026/frame-5.png', route => route.abort());
  await page.locator('.story-card').filter({ hasText: 'Bangalore: five views of a lake corridor' }).click();
  await page.getByRole('button', { name: 'Frame 5: 2026-10-13', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This observation image could not be loaded.' }).waitFor();
  await page.getByRole('button', { name: 'Frame 1: 2026-06-27', exact: true }).click();
  await page.waitForFunction(() => { const img = document.querySelector('.story-sequence-images img'); return img?.complete && img.naturalWidth > 0; });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.unroute('**/bangalore-sequence-2026/frame-5.png');
  assert.deepEqual(failedAssets, []);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ status: 'passed', browser: await browser.version(), results, legacyStory: 'passed', returnToGlobe: 'passed', missingStory: 'passed', missingImageRecovery: 'passed', errors, failedAssets }, null, 2));
  console.log(JSON.stringify({ status: 'passed', results, legacyStory: 'passed', returnToGlobe: 'passed' }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify({errors, failedAssets})}`);
  throw error;
} finally {
  await browser.close();
}
