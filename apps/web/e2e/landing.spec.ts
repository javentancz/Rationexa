import { expect, test } from "playwright/test";

test("presents the product without loading private workspace data", async ({ page }) => {
  let bootstrapRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/bootstrap") bootstrapRequests += 1;
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Remember why a decision was made/ })).toBeVisible();
  await expect(page.getByText("No sign-up required")).toBeVisible();
  expect(bootstrapRequests).toBe(0);
});

test("loads an editable sample into an isolated guest workflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try a sample decision" }).first().click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await expect(page.getByLabel("Decision source")).toHaveValue(/Choose an identity provider/);
  await expect(page.getByLabel("Decision source")).toHaveValue(/audit logs/);
});
