import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const supplierRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portfolioRoot = resolve(supplierRoot, '..', 'portfolio')
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))
assert.ok(executablePath, 'Chrome/Chromium not found. Set CHROME_PATH.')

async function reachable(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function startPreview(root, port) {
  const url = `http://127.0.0.1:${port}/`
  if (await reachable(url)) return null
  const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    if (await reachable(url)) return child
  }
  child.kill()
  throw new Error(`Preview did not start at ${url}`)
}

const previewServers = [await startPreview(supplierRoot, 4173), await startPreview(portfolioRoot, 4174)].filter(Boolean)
const browser = await chromium.launch({ executablePath, headless: true })

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' })
  await desktop.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  const supplierPage = await desktop.newPage()
  await supplierPage.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })
  await supplierPage.getByRole('heading', { name: '10 поставщиков' }).waitFor()
  assert.equal(await supplierPage.locator('.supplier-row').count(), 10)
  await supplierPage.getByRole('button', { name: 'Цена опубликована', exact: true }).click()
  assert.ok(await supplierPage.locator('.supplier-row').count() < 10)
  assert.ok(await supplierPage.locator('.supplier-row').count() > 0)
  await supplierPage.getByRole('button', { name: 'Цена опубликована', exact: true }).click()
  await supplierPage.evaluate(() => document.fonts.ready)
  await supplierPage.screenshot({ path: '.qa-supplier-desktop.png', fullPage: true, animations: 'disabled' })

  const compareButtons = supplierPage.getByRole('button', { name: 'Сравнить' })
  await compareButtons.nth(0).click()
  await compareButtons.nth(0).click()
  await supplierPage.locator('.selection-bar').getByRole('button', { name: /Сравнить 2/ }).click()
  await supplierPage.getByRole('dialog', { name: /Сравнение 2 поставщиков/ }).waitFor()
  assert.equal(await supplierPage.locator('.compare-column').count(), 2)
  await supplierPage.screenshot({ path: '.qa-compare-desktop.png', animations: 'disabled' })
  await supplierPage.locator('.compare-name button').first().click()
  await supplierPage.locator('.compare-panel').waitFor({ state: 'hidden' })

  await supplierPage.locator('.row-main').first().click()
  await supplierPage.locator('.evidence-drawer').waitFor()
  assert.ok((await supplierPage.locator('.evidence-drawer a[target="_blank"]').first().getAttribute('href'))?.startsWith('https://'))
  await supplierPage.screenshot({ path: '.qa-supplier-e2e.png', fullPage: true, animations: 'disabled' })
  await supplierPage.keyboard.press('Escape')
  await supplierPage.locator('.evidence-drawer').waitFor({ state: 'hidden' })

  const portfolioPage = await desktop.newPage()
  await portfolioPage.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' })
  await portfolioPage.getByRole('heading', { level: 1, name: /Михаил/ }).waitFor()
  assert.equal(await portfolioPage.locator('.project').count(), 3)
  assert.equal(await portfolioPage.locator('.hero-actions').getByRole('link', { name: 'GitHub', exact: true }).getAttribute('href'), 'https://github.com/ANOWIZ')
  assert.equal(await portfolioPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
  await portfolioPage.evaluate(() => document.fonts.ready)
  await portfolioPage.screenshot({ path: '.qa-portfolio-e2e.png', fullPage: true, animations: 'disabled' })
  await portfolioPage.screenshot({ path: '.qa-portfolio-desktop.png', animations: 'disabled' })
  await desktop.close()

  for (const width of [320, 390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' })
    for (const [name, port] of [['supplier', 4173], ['portfolio', 4174]]) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      const typography = await page.evaluate(() => {
        const small = [...document.querySelectorAll('main *, header *')].filter(el => {
          if (!el.getClientRects().length || el.closest('.sr-only')) return false
          const hasText = [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          return hasText && parseFloat(getComputedStyle(el).fontSize) < 14
        }).map(el => el.textContent.slice(0, 60))
        return {
          font: document.fonts.check('18px "Golos Text Variable"', 'Привет'),
          body: getComputedStyle(document.body).fontSize,
          fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          small,
        }
      })
      assert.equal(typography.fits, true, `${name}: horizontal overflow at ${width}px`)
      assert.equal(typography.font, true, `${name}: Cyrillic font did not load`)
      assert.equal(typography.body, '18px')
      assert.deepEqual(typography.small, [], `${name}: tiny text at ${width}px`)
      assert.deepEqual(errors, [], `${name}: browser errors`)
      if (width === 390) {
        await page.screenshot({ path: `.qa-${name}-mobile.png`, animations: 'disabled' })
        if (name === 'portfolio') {
          await page.getByRole('button', { name: 'Открыть меню' }).click()
          await page.getByRole('navigation').getByRole('link', { name: 'Опыт' }).click()
          assert.equal(await page.getByRole('button', { name: 'Открыть меню' }).getAttribute('aria-expanded'), 'false')
        } else {
          await page.locator('.row-main').first().click()
          await page.screenshot({ path: '.qa-drawer-mobile.png', animations: 'disabled' })
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: 'Сравнить' }).first().click()
          await page.getByRole('button', { name: 'Сравнить' }).first().click()
          await page.locator('.selection-bar button').click()
          await page.screenshot({ path: '.qa-compare-mobile.png', animations: 'disabled' })
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          const cellSizes = await page.locator('.compare-column').first().locator(':scope > *').evaluateAll(elements => elements.map(el => ({ height: el.clientHeight, needed: el.scrollHeight })))
          assert.ok(cellSizes.every(cell => cell.needed <= cell.height + 1), 'Comparison text must fit its row')
          await page.keyboard.press('Escape')
        }
      }
      await page.close()
    }
    await context.close()
  }
  console.log('E2E passed: filters, compare, evidence drawer, links, mobile menu; Cyrillic font, 18px body, no text below 14px and no overflow at five viewport widths.')
} finally {
  await browser.close()
  for (const server of previewServers) server.kill()
}
