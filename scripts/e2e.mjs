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

  const compareButtons = supplierPage.getByRole('button', { name: 'Сравнить' })
  await compareButtons.nth(0).click()
  await compareButtons.nth(0).click()
  await supplierPage.locator('.selection-bar').getByRole('button', { name: /Сравнить 2/ }).click()
  await supplierPage.getByRole('dialog', { name: /Сравнение 2 поставщиков/ }).waitFor()
  assert.equal(await supplierPage.locator('.compare-column').count(), 2)
  await supplierPage.locator('.compare-name button').first().click()
  await supplierPage.locator('.compare-panel').waitFor({ state: 'hidden' })

  await supplierPage.locator('.row-main').first().click()
  await supplierPage.locator('.evidence-drawer').waitFor()
  assert.ok((await supplierPage.locator('.evidence-drawer a[target="_blank"]').first().getAttribute('href'))?.startsWith('https://'))
  await supplierPage.screenshot({ path: '.qa-supplier-e2e.png', fullPage: true })
  await supplierPage.keyboard.press('Escape')
  await supplierPage.locator('.evidence-drawer').waitFor({ state: 'hidden' })

  const portfolioPage = await desktop.newPage()
  await portfolioPage.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' })
  await portfolioPage.getByRole('heading', { name: /AI Automation/ }).waitFor()
  assert.equal(await portfolioPage.locator('.project').count(), 3)
  assert.equal(await portfolioPage.getByRole('link', { name: /GitHub · проекты/ }).getAttribute('href'), 'https://github.com/ANOWIZ')
  assert.equal(await portfolioPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
  for (const section of await portfolioPage.locator('.reveal').all()) {
    await section.scrollIntoViewIfNeeded()
    await portfolioPage.waitForTimeout(120)
  }
  await portfolioPage.locator('#top').scrollIntoViewIfNeeded()
  await portfolioPage.screenshot({ path: '.qa-portfolio-e2e.png', fullPage: true })
  await desktop.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'ru-RU' })
  await mobile.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  for (const url of ['http://127.0.0.1:4173/', 'http://127.0.0.1:4174/']) {
    const page = await mobile.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('main').waitFor()
    const fitsViewport = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    assert.equal(fitsViewport, true, `Horizontal overflow at ${url}`)
    await page.close()
  }
  await mobile.close()
  console.log('E2E passed: supplier filters surface, compare, evidence drawer, portfolio links, desktop/mobile overflow.')
} finally {
  await browser.close()
  for (const server of previewServers) server.kill()
}
