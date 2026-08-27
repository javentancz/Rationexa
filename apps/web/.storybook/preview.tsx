import type { Preview } from "@storybook/nextjs-vite";
import { Providers } from "../app/providers";
import "../app/styles.css";

const preview: Preview = {
  decorators: [(Story) => <Providers><div style={{ padding: 32, maxWidth: 760 }}><Story /></div></Providers>],
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
  },
};

export default preview;
