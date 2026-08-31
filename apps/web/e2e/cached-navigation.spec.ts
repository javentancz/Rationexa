import { expect, test } from "playwright/test";

test("keeps an unfinished draft mounted across tabs and lets the reviewer discard it", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("Draft decision context that must survive navigation.");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("button", { name: "Continue current draft" })).toContainText("Draft decision context");

  await page.getByRole("button", { name: /Discard .* draft/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("No finalized decision records will be changed");
  await dialog.getByRole("button", { name: "Discard draft" }).click();

  await expect(page.getByRole("button", { name: "Continue current draft" })).toHaveCount(0);
  await expect(page.getByText("Draft discarded")).toBeVisible();
});

test("reuses workspace and account data when moving between application tabs", async ({ page }) => {
  let bootstrapRequests = 0;
  let accountRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/v1/bootstrap") bootstrapRequests += 1;
    if (pathname === "/v1/account" && request.method() === "GET") accountRequests += 1;
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Your AI runtime" })).toBeVisible();
  const accountRequestsAfterInitialLoad = accountRequests;
  expect(accountRequestsAfterInitialLoad).toBeGreaterThan(0);
  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page.getByRole("heading", { name: "Your AI runtime" })).toBeVisible();
  await page.getByRole("button", { name: "New decision review" }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  expect(bootstrapRequests).toBe(1);
  expect(accountRequests).toBe(accountRequestsAfterInitialLoad);
});
