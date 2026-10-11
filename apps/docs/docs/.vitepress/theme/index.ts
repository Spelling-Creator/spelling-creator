import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import DemoVideo from "./DemoVideo.vue";

// The default theme, plus the components pages can use directly in Markdown.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DemoVideo", DemoVideo);
  },
} satisfies Theme;
