// Ported from react-native-vision-camera/docs/src/lib/api-relative-link.tsx
// and resolve-api-link.ts. TypeDoc writes links like `NetworkInspector.mdx#enable`,
// and fumadocs' own resolveHref only rewrites hrefs that start with `./` or `../`.
import * as path from 'node:path'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { ComponentProps } from 'react'

type SourceLike = {
  getPageByHref: (
    href: string,
    options: { dir: string; language?: string | undefined },
  ) => { page: { url: string }; hash?: string } | undefined
}

function isLocalHref(href: string): boolean {
  return (
    href.length > 0 &&
    !href.startsWith('#') &&
    !href.startsWith('http://') &&
    !href.startsWith('https://') &&
    !href.startsWith('mailto:')
  )
}

function toSourceRelativeHref(href: string): string {
  if (href.startsWith('/') || href.startsWith('./')) {
    return href
  }
  return `./${href}`
}

export function createApiRelativeLink(
  source: SourceLike,
  page: { path: string; locale?: string | undefined },
  OverrideLink = defaultMdxComponents.a,
) {
  return function ApiRelativeLink({ href, ...props }: ComponentProps<'a'>) {
    if (typeof href === 'string' && isLocalHref(href)) {
      const target = source.getPageByHref(toSourceRelativeHref(href), {
        dir: path.dirname(page.path),
        language: page.locale,
      })
      if (target != null) {
        href = target.hash ? `${target.page.url}#${target.hash}` : target.page.url
      }
    }

    return <OverrideLink href={href} {...props} />
  }
}
