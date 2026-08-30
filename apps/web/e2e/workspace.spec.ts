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

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
};
const workspace = {
  id: "workspace-1",
  name: "Personal workspace",
  account_id: "account-1",
  account_name: "Demo User",
  mode: "local_personal",
  created_at: "2026-08-28T00:00:00Z",
};

async function mockBootstrap(page: Page, decisions: unknown[] = [], activeWorkspace = workspace) {
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    models,
    workspace: activeWorkspace,
    library: { items: decisions, total: decisions.length },
  } }));
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: models, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: activeWorkspace }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: decisions, total: decisions.length } }));
}

test("does not restore another workspace's browser draft", async ({ page }) => {
  const privateWorkspace = {
    ...workspace,
    id: "workspace-b",
    account_id: "account-b",
    account_name: "Reviewer B",
    mode: "authenticated_personal",
  };
  await mockBootstrap(page, [], privateWorkspace);
  await page.addInitScript(() => localStorage.setItem("rationexa-workspace-draft-v1", JSON.stringify({
    workspaceId: "workspace-a",
    source: "Private draft belonging to reviewer A",
    workflowView: 1,
    view: "workspace",
  })));

  await page.goto("/");

  await expect(page.getByLabel("Decision source")).toHaveValue("");
  await expect(page.getByText("Private draft belonging to reviewer A")).toHaveCount(0);
});

test("keeps an unfinished decision available after visiting the library", async ({ page }) => {
  await mockBootstrap(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByLabel("Decision source").fill("Draft decision that still needs review");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("button", { name: /Continue current draft/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue current draft/ }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByLabel("Decision source")).toHaveValue("Draft decision that still needs review");
});

test("uses clean paths for workspace sections", async ({ page }) => {
  await mockBootstrap(page);
  await page.route(/\/v1\/account(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.goto("/library");

  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Usage and cost" }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.url()).not.toContain("#");
});

test("keeps a clean password-reset URL available while signed out", async ({ page }) => {
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Sign in required" } }));
  await page.route(/\/v1\/account(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.goto("/account/reset?token=clean-reset-token");

  await expect(page).toHaveURL(/\/account\/reset\?token=clean-reset-token$/);
  await expect(page.getByLabel("One-time reset token")).toHaveValue("clean-reset-token");
  await expect(page.url()).not.toContain("#");
});

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
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    models: unavailableModels,
    workspace,
    library: { items: [], total: 0 },
  } }));
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: unavailableModels, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: workspace }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: [], total: 0 } }));

  await page.goto("/");
  await page.getByLabel("Decision source").fill("We decided to use the pilot architecture.");

  await expect(page.getByText("Not installed. Run `ollama pull missing:latest`.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract decision →" })).toBeDisabled();
});
