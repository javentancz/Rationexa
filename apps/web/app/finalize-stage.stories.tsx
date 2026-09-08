import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { FinalizeConfirmation } from "./finalize-stage";

const premises = [
  { candidate_id: "premise-1" },
  { candidate_id: "premise-2" },
];

const reviews = {
  "premise-1": { action: "confirm" as const, kind: "hard_constraint", statement: "The service must retain an auditable decision record." },
  "premise-2": { action: "unknown" as const, kind: "assumption", statement: "The provider will continue supporting the required integration." },
};

const meta = {
  title: "Rationexa/Workflow/Finalize",
  component: FinalizeConfirmation,
  args: {
    title: "Choose a document integration provider",
    question: "Which provider should support the enterprise document workflow?",
    chosenOption: "Provider B",
    rationale: "It satisfies the confirmed audit and integration constraints.",
    criticality: "important",
    counts: { confirm: 1, unknown: 1, reject: 0 },
    premises,
    reviews,
    busy: false,
    onBack: fn(),
    onFinalize: fn(),
  },
} satisfies Meta<typeof FinalizeConfirmation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmationSummary: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Save the reviewed record" })).toBeVisible();
    await expect(canvas.getByText("Human judgments preserved")).toBeVisible();
    await expect(canvas.getByText("The provider will continue supporting the required integration.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Finalize and save" }));
    await expect(args.onFinalize).toHaveBeenCalledOnce();
  },
};

export const Saving: Story = {
  args: { busy: true },
};
