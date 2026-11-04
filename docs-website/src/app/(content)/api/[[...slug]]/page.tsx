import {
  DocsBody,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createApiRelativeLink } from '@/lib/api-relative-link'
import { getOgImage, siteConfig } from '@/lib/site-config'
import { apiSource } from '@/lib/source'
import { tocSlots } from '@/lib/toc-slots'
import { getMDXComponents } from '@/mdx-components'

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>
}) {
  const params = await props.params
  const page = apiSource.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage toc={page.data.toc} full={page.data.full} slots={tocSlots}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createApiRelativeLink(apiSource, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return apiSource.generateParams()
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>
}): Promise<Metadata> {
  const params = await props.params
  const page = apiSource.getPage(params.slug)
  if (!page) notFound()

  const image = getOgImage(page.url)

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      siteName: siteConfig.name,
      url: page.url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      images: [image],
    },
  }
}
