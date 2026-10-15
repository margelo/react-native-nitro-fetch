// Follows react-native-vision-camera/docs/src/app/(content)/api/search/route.ts:
// one index over both the guides and the API reference.
import { createSearchAPI } from 'fumadocs-core/search/server'
import type { InferPageType } from 'fumadocs-core/source'
import { apiSource, docsSource } from '@/lib/source'

type AnyPage =
  | InferPageType<typeof docsSource>
  | InferPageType<typeof apiSource>

function buildIndex(page: AnyPage) {
  return {
    id: page.url,
    title: page.data.title ?? page.url,
    description: page.data.description,
    url: page.url,
    structuredData: page.data.structuredData,
  }
}

export const { GET } = createSearchAPI('advanced', {
  indexes: () => [
    ...docsSource.getPages().map(buildIndex),
    ...apiSource.getPages().map(buildIndex),
  ],
})
