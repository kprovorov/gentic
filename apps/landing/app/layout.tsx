import type { Metadata, Viewport } from "next"
import { Outfit } from "next/font/google"

import "./globals.css"

const siteUrl = new URL("https://gentic.chat")
const description =
  "Gentic coordinates AI coding and review agents to automate implementation, pull requests, code review, and fixes with less human involvement."

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
    "AI code review",
    "review agents",
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
      "Turn issues into reviewed pull requests. Gentic coordinates coding agents, review agents, and automatic fixes.",
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
      "Turn issues into reviewed pull requests. Gentic coordinates coding agents, review agents, and automatic fixes.",
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

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>{children}</body>
    </html>
  )
}
