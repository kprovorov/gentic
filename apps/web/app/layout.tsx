import type { Metadata } from "next"
import { Geist_Mono, Inter, Outfit } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"

import "./globals.css"
import { Providers } from "./providers"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@gentic/ui/theme-provider"
import { Toaster } from "@gentic/ui/sonner"
import { cn } from "@gentic/ui/utils"

export const metadata: Metadata = {
  title: {
    default: "Gentic",
    template: "%s | Gentic",
  },
  description:
    "Gentic helps teams create coding issues, assign them to agents, and track pull requests through review.",
  applicationName: "Gentic",
  openGraph: {
    title: "Gentic",
    description:
      "Create coding issues, assign them to agents, and track pull requests through review.",
    type: "website",
  },
}

const outfitHeading = Outfit({ subsets: ["latin"], variable: "--font-heading" })

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={cn(
          "antialiased",
          fontMono.variable,
          "font-sans",
          inter.variable,
          outfitHeading.variable
        )}
      >
        <body>
          <ThemeProvider>
            <Providers>
              <SiteHeader />
              {children}
            </Providers>
            <Toaster />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
