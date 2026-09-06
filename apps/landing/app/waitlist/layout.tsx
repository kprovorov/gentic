import { ClerkProvider } from "@clerk/nextjs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Join waitlist",
  description:
    "Join the Gentic waitlist for early access to your AI coding workspace.",
  alternates: { canonical: "/waitlist" },
}

export default function WaitlistLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      waitlistUrl="/waitlist"
      signInUrl="https://app.gentic.chat/login"
      localization={{
        waitlist: {
          start: { title: "Join waitlist", formButton: "Join waitlist" },
        },
      }}
      appearance={{
        variables: {
          fontFamily: "var(--font-outfit), sans-serif",
          colorPrimary: "var(--primary)",
          colorPrimaryForeground: "var(--primary-foreground)",
          colorForeground: "var(--foreground)",
          colorMutedForeground: "var(--muted-foreground)",
          colorBackground: "var(--background)",
          colorInput: "var(--background)",
          colorInputForeground: "var(--foreground)",
          colorBorder: "var(--border)",
          borderRadius: "var(--radius-lg)",
        },
        elements: {
          rootBox: { width: "100%" },
          cardBox: { width: "100%", borderRadius: "var(--radius-4xl)" },
          formButtonPrimary: {
            borderRadius: "var(--radius-4xl)",
            backgroundImage: "none",
            boxShadow: "none",
          },
          footerActionLink: { color: "var(--primary-foreground)" },
        },
      }}
    >
      {children}
    </ClerkProvider>
  )
}
