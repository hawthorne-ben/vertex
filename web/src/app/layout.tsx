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
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${crimsonPro.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Set theme class before render to avoid flash
                const saved = localStorage.getItem('theme')
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                const shouldBeDark = saved === 'dark' || (saved === null && prefersDark)

                if (shouldBeDark) {
                  document.documentElement.classList.add('dark')
                }
              } catch (e) {
                // Ignore errors
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

