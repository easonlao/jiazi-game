import { expect, type Locator, type Page } from '@playwright/test';

export function getPublicCard(page: Page, index = 0): Locator {
  return page.locator(`[data-public-card-index="${index}"] .card-in`).first();
}

export function getHandCard(page: Page, index = 0): Locator {
  return page.locator(`[data-hand-card-slot="${index}"] > .card-in`).first();
}

export function getPublicCardHistoryModal(page: Page) {
  return page.getByTestId('public-card-history-modal');
}

export async function openPublicCardHistory(page: Page, card: Locator) {
  const modal = getPublicCardHistoryModal(page);
  await card.getByTestId('card-history-button').click();
  await expect(modal).toBeVisible();
  return modal;
}

export async function closePublicCardHistory(page: Page, method: 'button' | 'escape' = 'button') {
  const modal = getPublicCardHistoryModal(page);
  if (method === 'button') {
    await page.getByTestId('public-card-history-close').click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(modal).toBeHidden();
}

export async function selectPublicCard(page: Page, index = 0) {
  const card = getPublicCard(page, index);
  await card.click();
  await expect(card).toHaveAttribute('data-selected', 'true');
  await expect(getPublicCardHistoryModal(page)).toHaveCount(0);
  return card;
}
