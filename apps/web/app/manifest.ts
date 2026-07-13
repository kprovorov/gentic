import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gentic",
    short_name: "Gentic",
    description:
      "Gentic helps teams create coding issues, assign them to agents, and track pull requests through review.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icon",
        sizes: "64x64",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  }
}
