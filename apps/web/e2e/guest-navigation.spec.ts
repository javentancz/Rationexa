import { expect, test } from "playwright/test";

test("lets a hosted guest explore tabs and preserves the draft until a private action", async ({ page }) => {
  await page.route("**/v1/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        guest: true,
        workspace: {
          id: "browser-guest-workspace",
          name: "Guest workspace",
          account_id: "browser-guest-account",
          account_name: "Guest reviewer",
          mode: "guest_personal",
          created_at: new Date().toISOString(),
        },
        library: { items: [], total: 0 },
        models: {
          default_model_id: "deterministic/rules-v1",
          models: [{
            id: "deterministic/rules-v1",
            provider: "deterministic",
            model: "rules-v1",
            label: "Deterministic rules",
            location: "local",
            best_for: "Fast tests without a language model",
            available: true,
          }],
        },
      }),
    });
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await page.getByLabel("Decision source").fill("A guest draft that should survive navigation.");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByText("Private browser trial")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue current draft" })).toBeVisible();

  await page.getByRole("button", { name: "Usage and cost" }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByText("Temporary usage")).toBeVisible();

  await page.getByRole("button", { name: /A guest draft that should survive navigation/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByLabel("Decision source")).toHaveValue("A guest draft that should survive navigation.");

  await expect(page.getByRole("button", { name: "Try deterministic extraction →" })).toBeEnabled();
});
