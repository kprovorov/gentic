import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Outfit } from "next/font/google"
import { ClerkProvider, Show } from "@clerk/nextjs"

import "./globals.css"
import { Providers } from "./providers"
import { AppSidebar } from "@/components/app-sidebar"
import { NewIssueDialog } from "@/components/new-issue-dialog"
import { NewIssueDialogProvider } from "@/components/new-issue-dialog-provider"
import { PublicHeader } from "@/components/public-header"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { SiteHeader } from "@/components/site-header"
import { queryKeys } from "./query-keys"
import { SidebarInset, SidebarProvider } from "@gentic/ui/sidebar"
import { ThemeProvider } from "@gentic/ui/theme-provider"
import { Toaster } from "@gentic/ui/sonner"
import { TooltipProvider } from "@gentic/ui/tooltip"
import { cn } from "@gentic/ui/utils"

export const metadata: Metadata = {
  title: {
    default: "Gentic",
    template: "%s | Gentic",
  },
  description:
    "Gentic helps teams create coding issues, assign them to agents, and track pull requests through review.",
  applicationName: "Gentic",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Gentic",
  },
  openGraph: {
    title: "Gentic",
    description:
      "Create coding issues, assign them to agents, and track pull requests through review.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
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
            <TooltipProvider>
              <Providers>
                <Show when="signed-in">
                  <NewIssueDialogProvider>
                    <SidebarProvider>
                      <AppSidebar variant="inset" />
                      <SidebarInset>
                        <SiteHeader />
                        {children}
                      </SidebarInset>
                    </SidebarProvider>
                    <NewIssueDialog />
                    {/* Keep every label picker's catalog (the globally
                        available new-issue dialog, the issue detail rail, and
                        the standalone create page) live across tabs. Definition
                        changes land on the `labels` table; RLS scopes the
                        subscription to this account. */}
                    <RealtimeRefresh
                      channelName="label-catalog"
                      tables={["labels"]}
                      queryKey={queryKeys.settingsLabelsRoot}
                    />
                  </NewIssueDialogProvider>
                </Show>
                <Show when="signed-out">
                  <PublicHeader />
                  {children}
                </Show>
              </Providers>
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
