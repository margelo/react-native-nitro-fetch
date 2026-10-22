import { loader } from 'fumadocs-core/source'
import { apiReference, docs } from '../../.source/server'

export const docsSource = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})

export const apiSource = loader({
  baseUrl: '/api',
  source: apiReference.toFumadocsSource(),
})
