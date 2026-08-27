import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ConfirmDialog, Disclosure, Hint } from "./ui";

const meta = {
  title: "Rationexa/Interaction primitives",
  component: Disclosure,
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsibleDetails: Story = {
  args: { title: "Audit trail", summary: "4 recorded events", children: <p>Decision finalized by a human reviewer.</p> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /audit trail/i });
    await userEvent.click(trigger);
    await expect(canvas.getByText(/decision finalized/i)).toBeVisible();
    await expect(trigger).toHaveAttribute("data-state", "open");
  },
};

export const PortalledTooltip: Story = {
  args: { title: "Tooltip fixture", children: null },
  render: () => <Hint label="Delete decision"><button type="button">Delete</button></Hint>,
};

export const DestructiveConfirmation: StoryObj<typeof ConfirmDialog> = {
  render: () => <ConfirmDialog open title="Delete this decision?" description="This action cannot be undone." confirmLabel="Delete permanently" busyLabel="Deleting…" onOpenChange={fn()} onConfirm={fn()} />,
};
