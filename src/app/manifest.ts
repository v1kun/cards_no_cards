import type { MetadataRoute } from "next";

/**
 * Web app manifest for installable PWA behavior.
 *
 * Served at `/manifest.webmanifest`. Icons live under `public/icons`. The
 * maskable icon keeps its artwork inside a safe zone so Android/iOS masks do
 * not clip it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cards No Cards",
    short_name: "Cards",
    description: "Personal Spanish vocabulary-retention app.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
