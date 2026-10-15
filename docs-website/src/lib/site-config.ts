// Follows react-native-vision-camera/docs/src/lib/site-config.ts.
export const siteConfig = {
  name: 'Nitro Fetch',
  description:
    'A fetch() replacement for React Native powered by Cronet and URLSession, with HTTP/3, QUIC, prefetching, WebSockets and worklets.',
  tagline: 'Performant network requests, done right.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fetch.margelo.com'
  ),
  og: {
    width: 1200,
    height: 630,
  },
} as const

export function getOgImage(pageUrl: string) {
  return {
    url: pageUrl === '/' ? '/og' : `/og${pageUrl}`,
    width: siteConfig.og.width,
    height: siteConfig.og.height,
  }
}
