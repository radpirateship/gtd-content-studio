import React from "react"
import type { Metadata } from 'next'
import { Instrument_Sans, JetBrains_Mono, Newsreader } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import ChatWrapper from '@/components/ChatWrapper'
import './globals.css'

const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: '--font-instrument' })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: '--font-jetbrains' })
const newsreader = Newsreader({ subsets: ["latin"], variable: '--font-newsreader' })

export const metadata: Metadata = {
  title: 'PPW Content Studio | Peak Primal Wellness',
  description: 'AI-powered content automation for wellness equipment articles',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${instrumentSans.variable} ${jetbrainsMono.variable} ${newsreader.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {children}
        <Analytics />
        <ChatWrapper />
      </body>
    </html>
  )
}
