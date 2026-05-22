import type { MetadataRoute } from "next";

/**
 * PWA manifest. Adds enough metadata that iOS / Android / desktop
 * "add to home screen" picks up Hugo's name, theme colour, and the
 * right icons — instead of falling back to generic browser defaults.
 *
 * Stays deliberately small. `display: "minimal-ui"` keeps the address
 * bar visible when installed; the brand's rule is "open a tab, use
 * it, close it" and promoting the site into a chromeless app shell
 * would oversell what it is. Minimal-ui keeps it honest: a website
 * you can pin.
 *
 * `theme_color` is tomato (Hugo's canonical static colour); the live
 * dot still cycles eight accents in the page itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hugos Lekstuga",
    short_name: "Lekstuga",
    description: "A small playhouse of browser tools.",
    start_url: "/",
    display: "minimal-ui",
    background_color: "#fbf6ee",
    theme_color: "#ff5a3c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon0", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
