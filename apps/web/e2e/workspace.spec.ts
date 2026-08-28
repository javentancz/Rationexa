import { expect, test, type Page } from "playwright/test";

const models = {
  default_model_id: "deterministic/rules-v1",
  models: [{
    id: "deterministic/rules-v1",
    provider: "deterministic",
    model: "rules-v1",
    label: "Deterministic rules",
    location: "local",
    best_for: "Fast tests",
    available: true,
  }],
};

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

async function mockBootstrap(page: Page, decisions: unknown[] = []) {
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: models, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    id: "workspace-1",
    name: "Personal workspace",
    account_id: "account-1",
    account_name: "Demo User",
    mode: "local_personal",
    created_at: "2026-08-28T00:00:00Z",
  } }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: decisions, total: decisions.length } }));
}

test("clears a deleted decision from restored workspace state", async ({ page }) => {
  await mockBootstrap(page);
  await page.route(/\/v1\/decisions\/deleted-decision$/, (route) => route.fulfill({ status: 404, headers: corsHeaders, json: { detail: "Decision not found" } }));
  await page.route(/\/v1\/decisions\/deleted-decision\/revisit-checks$/, (route) => route.fulfill({ status: 404, headers: corsHeaders, json: { detail: "Decision not found" } }));
  await page.addInitScript(() => localStorage.setItem("rationexa-workspace-draft-v1", JSON.stringify({ decisionId: "deleted-decision", workflowView: 4, view: "workspace" })));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible();
  await expect(page.getByText("The deleted decision was removed from your restored workspace")).toBeVisible();
  await expect(page.locator(".error")).toHaveCount(0);
});

test("delete confirmation stays visible and can be cancelled", async ({ page }) => {
  const decision = {
    id: "decision-1",
    title: "Architecture decision",
    question: "Which architecture should we use?",
    criticality: "important",
    status: "decision_ready",
    premise_count: 2,
    revisit_count: 0,
    pending_revisit_count: 0,
    created_at: "2026-08-28T00:00:00Z",
  };
  await mockBootstrap(page, [decision]);
  await page.goto("/");
  await page.getByRole("button", { name: "All decisions" }).click();
  await page.getByRole("button", { name: "Delete Architecture decision" }).click();

  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete this decision?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("unavailable models explain the problem and block extraction", async ({ page }) => {
  const unavailableModels = {
    default_model_id: "ollama/missing:latest",
    models: [{
      id: "ollama/missing:latest",
      provider: "ollama",
      model: "missing:latest",
      label: "Missing model",
      location: "local",
      best_for: "Local reasoning",
      available: false,
      availability_reason: "Not installed. Run `ollama pull missing:latest`.",
    }],
  };
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: unavailableModels, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    id: "workspace-1",
    name: "Personal workspace",
    account_id: "account-1",
    account_name: "Demo User",
    mode: "local_personal",
    created_at: "2026-08-28T00:00:00Z",
  } }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: [], total: 0 } }));

  await page.goto("/");
  await page.getByLabel("Decision source").fill("We decided to use the pilot architecture.");

  await expect(page.getByText("Not installed. Run `ollama pull missing:latest`.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract decision →" })).toBeDisabled();
});
