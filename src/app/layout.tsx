import type { Metadata } from "next"
import { Crimson_Pro, JetBrains_Mono } from "next/font/google"
import "./globals.css"

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
  title: "Vertex - The Point of Performance",
  description: "IMU cycling data analysis platform for detailed riding dynamics insights",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
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
    <html lang="en" className={`${crimsonPro.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}

