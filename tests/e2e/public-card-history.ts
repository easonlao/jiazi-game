import { expect, type Locator, type Page } from '@playwright/test';

export function getPublicCard(page: Page, index = 0): Locator {
  return page.locator(`[data-public-card-index="${index}"] .card-in`).first();
}

export function getPublicCardHistoryModal(page: Page) {
  return page.getByTestId('public-card-history-modal');
}

export async function openPublicCardHistory(page: Page, card: Locator) {
  const modal = getPublicCardHistoryModal(page);
  await card.click();
  await expect(modal).toBeVisible();
  await expect(card).toHaveAttribute('data-selected', 'true');
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

export async function selectPublicCardAndCloseHistory(page: Page, index = 0) {
  const card = getPublicCard(page, index);
  await openPublicCardHistory(page, card);
  await closePublicCardHistory(page);
  return card;
}
