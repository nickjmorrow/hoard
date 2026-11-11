import { expect, test, type Page } from '@playwright/test'

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('the library loads the seeded movies with no sideways scroll', async ({ page }) => {
  await page.goto('/')
  for (const name of ['Below the Ridge', 'Supper Club', 'The Lodger', 'Red Meadow']) await expect(page.getByText(name, { exact: true })).toBeVisible()
  await noSideScroll(page)
})

test('picking Cozy Mystery in the Vibe dropdown narrows the list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Vibe tags' }).click()
  await page.getByRole('checkbox', { name: /^Cozy Mystery/ }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Supper Club', { exact: true })).toBeVisible()
  await expect(page.getByText('The Lodger', { exact: true })).toBeVisible()
  await expect(page.getByText('Red Meadow', { exact: true })).toHaveCount(0)
  await noSideScroll(page)
})

test('a rating set on the title page is still there after a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Red Meadow', { exact: true }).click()
  await page.getByRole('button', { name: '4 stars' }).click()
  await expect(page.getByRole('group', { name: 'Rating: 4 of 5' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByRole('group', { name: 'Rating: 4 of 5' })).toBeVisible()
  await noSideScroll(page)
})

test('the add and tags screens fit a phone', async ({ page }) => {
  await page.goto('/add')
  await noSideScroll(page)
  await page.goto('/tags')
  await expect(page.getByRole('button', { name: /^Cozy Mystery, 2 titles, in Vibe/ })).toBeVisible()
  await noSideScroll(page)
})

test('a title can be started and then rated straight away, keeping its address', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add a title' }).click()
  await page.getByLabel('Name').fill('The Heirloom')
  await page.getByRole('button', { name: 'Save to Hoard' }).click()
  await page.waitForURL(/\/title\//)
  const address = page.url()
  await page.getByRole('button', { name: 'Doing', exact: true }).click()
  await page.getByRole('button', { name: '4 stars' }).click()
  await expect(page).toHaveURL(address)
  await page.waitForTimeout(1500)
  await expect(page.getByText(/Couldn’t save/)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('group', { name: 'Rating: 4 of 5' })).toBeVisible()
  // Back from the title goes to the library, not to the Add form it was saved from.
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
})

test('a message after adding doesn’t cover Remove from Hoard', async ({ page }) => {
  await page.goto('/add')
  await page.getByLabel('Name').fill('Opal')
  await page.getByRole('button', { name: 'Save to Hoard' }).click()
  const toast = page.locator('.toast')
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  const r = (await page.getByRole('button', { name: 'Remove from Hoard' }).boundingBox())!
  expect(t.y + t.height <= r.y || r.y + r.height <= t.y).toBe(true)
})
