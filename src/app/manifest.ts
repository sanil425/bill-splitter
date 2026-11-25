import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SplitIt",
    short_name: "SplitIt",
    description: "Split a bill from receipt photos and a quick note on who had what.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF9",
    theme_color: "#047857",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
