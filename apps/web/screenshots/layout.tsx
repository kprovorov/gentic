import { Inter, Outfit, Geist_Mono } from "next/font/google"
import "@/app/globals.css"
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
const outfit = Outfit({ subsets: ["latin"], variable: "--font-heading" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })
export default function CaptureLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} ${mono.variable} font-sans antialiased`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}
