import { defineConfig, type Plugin } from "vite";

/** Keep stylesheets ahead of module scripts so first paint is styled. */
function cssBeforeJs(): Plugin {
  return {
    name: "css-before-js",
    transformIndexHtml(html) {
      const linkRe = /<link\b[^>]*rel=["']stylesheet["'][^>]*>\s*/gi;
      const links = html.match(linkRe) ?? [];
      if (!links.length) return html;

      const withoutLinks = html.replace(linkRe, "");
      const scriptIdx = withoutLinks.search(/<script\b/i);
      if (scriptIdx === -1) return html;

      return (
        withoutLinks.slice(0, scriptIdx) +
        links.join("") +
        withoutLinks.slice(scriptIdx)
      );
    },
  };
}

export default defineConfig({
  base: "/kml-viewer/",
  plugins: [cssBeforeJs()],
});
