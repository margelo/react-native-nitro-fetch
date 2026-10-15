import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { getOgImage, siteConfig } from '@/lib/site-config'
import './global.css'

const geist = Geist({
  display: 'block',
  variable: '--font-geist',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  display: 'block',
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: siteConfig.metadataBase,
  applicationName: siteConfig.name,
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  openGraph: {
    siteName: siteConfig.name,
    images: [getOgImage('/')],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@margelo_com',
    images: [getOgImage('/')],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
