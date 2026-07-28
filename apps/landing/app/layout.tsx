import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"

import "./globals.css"

export const metadata: Metadata = {
  title: "Gentic",
  description: "Gentic marketing site.",
  applicationName: "Gentic",
  openGraph: {
    title: "Gentic",
    description: "Gentic marketing site.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
}

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
