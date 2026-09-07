import { expect, test } from "playwright/test";

test("completes the supervised pilot workflow in the browser", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/workspace");

  await page.getByLabel("Decision source").fill(
    "We decided to use Vendor B because it was assumed that Vendor B does not support external users. "
    + "The service must support SAML. Revisit if Vendor B introduces external-user support.",
  );
  await page.getByRole("button", { name: "Extract decision →" }).click();
  await expect(page.getByRole("heading", { name: "Review the extracted decision" })).toBeVisible();

  const premiseCards = page.locator(".premise-card");
  const premiseCount = await premiseCards.count();
  expect(premiseCount).toBeGreaterThan(0);
  await expect(premiseCards.first().locator(".premise-source-preview")).toBeVisible();
  await expect(premiseCards.first().getByText("Your judgment")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue to finalize →" });
  for (let index = 0; index < premiseCount; index += 1) {
    await premiseCards.nth(index).getByRole("button", { name: "? Keep unknown" }).click();
  }
  await expect(continueButton).toBeEnabled();
  for (let index = 0; index < premiseCount; index += 1) {
    await premiseCards.nth(index).getByRole("button", { name: "× Reject" }).click();
  }
  await expect(continueButton).toBeEnabled();
  for (let index = 0; index < premiseCount; index += 1) {
    await premiseCards.nth(index).getByRole("button", { name: "✓ Confirm" }).click();
  }

  await continueButton.click();
  await expect(page.getByRole("heading", { name: "Review the record before it becomes memory" })).toBeVisible();
  let releaseLibraryRefresh!: () => void;
  const libraryRefreshGate = new Promise<void>((resolve) => { releaseLibraryRefresh = resolve; });
  await page.route(/\/v1\/decisions(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") await libraryRefreshGate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Finalize and save" }).click();
  await expect(page.getByText("Decision finalized")).toBeVisible();
  await expect(page.locator(".finalized-summary")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Continue the decision conversation" })).toHaveCount(0);

  const finalizedTitle = await page.locator(".finalized-heading h2").innerText();
  await page.getByRole("button", { name: "All decisions" }).click();
  const savedConversation = page.locator(".decision-row").first();
  await expect(savedConversation).toContainText(finalizedTitle);
  releaseLibraryRefresh();
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator(".finalized-summary")).toBeVisible();

  await page.getByRole("button", { name: "Rename decision" }).click();
  await page.getByLabel("Decision name").fill("Pilot identity provider");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Decision renamed")).toBeVisible();
  await expect(page.locator(".finalized-heading h2")).toHaveText("Pilot identity provider");

  await expect(page.locator(".conversation-row.active")).toContainText("Pilot identity provider");

  await page.getByRole("button", { name: "Create share link" }).click();
  const shareCode = page.locator(".share-link code");
  await expect(shareCode).toContainText(`${new URL(page.url()).origin}/share/`);
  await expect(shareCode).not.toContainText("intentionally-wrong-api-origin.example");
  const shareUrl = await shareCode.innerText();
  const sharedPage = await page.context().newPage();
  await sharedPage.goto(shareUrl);
  const sharedHeader = sharedPage.locator(".share-header");
  await expect(sharedHeader).toHaveCSS("position", "sticky");
  await expect(sharedPage.getByRole("link", { name: "Rationexa home" })).toHaveAttribute("href", "/");
  await sharedPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Math.round((await sharedHeader.boundingBox())?.y ?? -1)).toBe(0);
  await sharedPage.close();

  await page.getByRole("button", { name: "Continue to revisit →" }).click();
  await expect(page.getByRole("heading", { name: "Continue the decision conversation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename decision" })).toBeVisible();
  await expect(page.locator(".revisit-composer")).toHaveCSS("position", "relative");
  await expect(page.getByLabel("Evidence review process")).toContainText("You decide what matters");
  await page.getByLabel("New evidence").fill("Vendor B now supports external users for all enterprise plans.");
  await page.getByRole("button", { name: "Check evidence against premises" }).click();
  await expect(page.getByText("Evidence check complete")).toBeVisible();

  const worthReviewing = page.getByRole("button", { name: "Worth reviewing" }).first();
  if (await worthReviewing.isVisible()) await worthReviewing.click();

  await page.getByRole("button", { name: "Finalize" }).click();
  await page.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("Decision deleted")).toBeVisible();
});
