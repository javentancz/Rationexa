import { expect, test } from "playwright/test";

test("lets a hosted guest explore tabs and preserves the draft until a private action", async ({ page }) => {
  await page.route("**/v1/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        guest: true,
        workspace: null,
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
  await expect(page.getByText("Your private library starts after sign-in")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue current draft" })).toBeVisible();

  await page.getByRole("button", { name: "Usage and cost" }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByText("Explore usage without being redirected")).toBeVisible();

  await page.getByRole("button", { name: /A guest draft that should survive navigation/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByLabel("Decision source")).toHaveValue("A guest draft that should survive navigation.");

  await page.getByRole("button", { name: "Create workspace to extract →" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText("Your draft is safe on this device")).toBeVisible();
});
