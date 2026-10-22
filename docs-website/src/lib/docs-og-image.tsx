import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notFound } from 'next/navigation'
import { ImageResponse } from 'next/og'
import { SiteLogo } from '@/components/site-logo'
import { siteConfig } from '@/lib/site-config'
import { apiSource, docsSource } from '@/lib/source'

// Follows react-native-vision-camera/docs/src/lib/docs-og-image.tsx, with the
// home page's background photo in place of its camera slider.

function readPublicFile(relativePath: string): Buffer {
  return readFileSync(join(process.cwd(), 'public', relativePath))
}

const background = `data:image/jpeg;base64,${readPublicFile('img/og-bg.jpg').toString('base64')}`
const geistRegular = readPublicFile('fonts/geist-400.woff')
const geistBold = readPublicFile('fonts/geist-700.woff')

function SiteOgImage({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  const hasDescription = description != null && description.length > 0
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#201f24',
        fontFamily: 'Geist',
      }}
    >
      <img
        src={background}
        alt=""
        width={siteConfig.og.width}
        height={siteConfig.og.height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundImage:
            'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.85))',
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          padding: 48,
        }}
      >
        <SiteLogo fill="#ffffff" width={259} height={30} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <p
            style={{
              display: '-webkit-box',
              WebkitLineClamp: hasDescription ? '2' : '3',
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: '#ffffff',
              fontSize: 100,
              fontWeight: 700,
              lineHeight: 1.15,
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {title}
          </p>
          {hasDescription && (
            <p
              style={{
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: 'rgba(255,255,255,0.75)',
                fontSize: 44,
                fontWeight: 400,
                lineHeight: 1.4,
                marginTop: 12,
                marginBottom: 0,
                marginLeft: 0,
                marginRight: 0,
              }}
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function renderOgImageResponse(title: string, description?: string) {
  return new ImageResponse(
    <SiteOgImage title={title} description={description} />,
    {
      width: siteConfig.og.width,
      height: siteConfig.og.height,
      fonts: [
        { name: 'Geist', data: geistRegular, weight: 400, style: 'normal' },
        { name: 'Geist', data: geistBold, weight: 700, style: 'normal' },
      ],
    }
  )
}

const sectionSources = {
  docs: docsSource,
  api: apiSource,
} as const

export function renderOpenGraphImage(slug?: string[]) {
  if (slug == null || slug.length === 0) {
    return renderOgImageResponse(siteConfig.name, siteConfig.tagline)
  }

  const [section, ...rest] = slug
  const source = sectionSources[section as keyof typeof sectionSources]
  if (source == null) notFound()

  const page = source.getPage(rest.length > 0 ? rest : undefined)
  if (!page) notFound()

  return renderOgImageResponse(
    String(page.data.title),
    page.data.description ?? undefined
  )
}
