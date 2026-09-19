import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { IBM_Plex_Sans_Arabic } from 'next/font/google'
import { DirectionProvider } from '@base-ui/react/direction-provider'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { LocaleProvider } from '@/components/locale-provider'
import { dirFor } from '@/lib/i18n'
import { getLocale, getT } from '@/lib/i18n/server'
import { loadMessages } from '@/lib/i18n/messages'
import './globals.css'

// Geist has no Arabic glyphs, so Arabic pages swap the sans stack for this
// (globals.css, html[lang="ar"]). Loaded for every page: next/font only
// serves the file to a browser that actually uses it.
const arabicSans = IBM_Plex_Sans_Arabic({
  weight: ['400', '500', '600', '700'],
  subsets: ['arabic', 'latin'],
  variable: '--font-arabic',
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return {
    title: t('TradeLoop — Trading Journal & Analytics'),
    description: t(
      'Track, journal, and analyze your futures, stocks, options, forex, and crypto trades. Automated daily journaling, equity curves, P&L calendar, and performance reports.',
    ),
    generator: 'v0.app',
    // Favicon and app icons come from app/favicon.ico, app/icon.png and
    // app/apple-icon.png (Next's file-based icon convention).
  }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const dir = dirFor(locale)
  const messages = await loadMessages(locale)
  return (
    <html lang={locale} dir={dir} className={`${GeistSans.variable} ${GeistMono.variable} ${arabicSans.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <LocaleProvider locale={locale} messages={messages}>
          <DirectionProvider direction={dir}>
            <ThemeProvider>
              {children}
              <Toaster richColors position="top-center" dir={dir} />
            </ThemeProvider>
          </DirectionProvider>
        </LocaleProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
