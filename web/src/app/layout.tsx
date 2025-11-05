import type { Metadata } from "next"
import { Crimson_Pro, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Header } from "@/components/layout/header"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from "@vercel/speed-insights/next"
import { ToastProvider } from "@/components/ui/toast-context"
import { ToastContainer } from "@/components/ui/toast-container"

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Vertex - Your ride, unencrypted",
  description: "IMU cycling data analysis platform for detailed riding dynamics insights",
  metadataBase: new URL('https://ridevertex.com'),
  // Note: icons removed - using manual <link> tags in <head> for theme-aware favicons
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${crimsonPro.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apple touch icon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Set theme class
                const saved = localStorage.getItem('theme')
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                const shouldBeDark = saved === 'dark' || (saved === null && prefersDark)

                if (shouldBeDark) {
                  document.documentElement.classList.add('dark')
                }

                // Set theme-aware favicon (ONLY based on system theme, not user preference)
                const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                const favicon32 = document.createElement('link')
                const favicon16 = document.createElement('link')

                favicon32.rel = 'icon'
                favicon32.type = 'image/png'
                favicon32.sizes = '32x32'
                favicon32.href = systemDark ? '/favicon-32x32-dark.png' : '/favicon-32x32.png'

                favicon16.rel = 'icon'
                favicon16.type = 'image/png'
                favicon16.sizes = '16x16'
                favicon16.href = systemDark ? '/favicon-16x16-dark.png' : '/favicon-16x16.png'

                document.head.appendChild(favicon32)
                document.head.appendChild(favicon16)

                // Listen for system theme changes
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                  favicon32.href = e.matches ? '/favicon-32x32-dark.png' : '/favicon-32x32.png'
                  favicon16.href = e.matches ? '/favicon-16x16-dark.png' : '/favicon-16x16.png'
                })
              } catch (e) {
                // Ignore errors, fallback to default favicon
                console.error('Favicon error:', e)
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ToastProvider>
          <Header />
          <main>{children}</main>
          <ToastContainer />
          <Analytics />
          <SpeedInsights />
        </ToastProvider>
      </body>
    </html>
  )
}

