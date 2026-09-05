import type { Metadata, Viewport } from "next"
import { Inter, Outfit } from "next/font/google"

import "./globals.css"

const siteUrl = new URL("https://gentic.chat")
const description =
  "Gentic is an AI coding agent management platform for creating issues, assigning them to Claude Code or Codex, and receiving pull requests automatically."

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Gentic — Your next idea, already in progress",
    template: "%s | Gentic",
  },
  description,
  applicationName: "Gentic",
  keywords: [
    "Gentic",
    "AI coding agents",
    "coding agent management",
    "Claude Code",
    "Codex",
    "automated pull requests",
  ],
  authors: [{ name: "Gentic" }],
  creator: "Gentic",
  publisher: "Gentic",
  category: "technology",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon", sizes: "1024x1024", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Gentic",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Gentic",
    description:
      "Create coding issues, assign them to AI agents, and get pull requests back for review.",
    url: "/",
    siteName: "Gentic",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Gentic",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Gentic",
    description:
      "Create coding issues, assign them to AI agents, and get pull requests back for review.",
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
}

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const outfit = Outfit({ subsets: ["latin"], variable: "--font-display" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body>{children}</body>
    </html>
  )
}
