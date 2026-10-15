import type {
  Callout,
  NodeOptions,
  Options as RemarkCalloutOptions,
} from '@r4ai/remark-callout'
import remarkCallout from '@r4ai/remark-callout'
import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from 'fumadocs-mdx/config'
import rehypePrism from 'rehype-prism-plus'
import { rehypeCodeTitles } from './src/lib/rehype-code-titles'

// `> [!TIP]`-style callouts, as in react-native-vision-camera/docs/source.config.ts:34-55.
function normalizeCalloutType(callout: Callout): string {
  const type = callout.type.toLowerCase()
  return type === 'important' ? 'info' : type
}

function createCalloutNode(tagName: string, callout: Callout): NodeOptions {
  return {
    tagName,
    properties: {
      type: normalizeCalloutType(callout),
    },
  }
}

const remarkCalloutOptions: RemarkCalloutOptions = {
  root: (callout) => createCalloutNode('callout-root', callout),
  title: (callout) => createCalloutNode('callout-title', callout),
  body: () => ({
    tagName: 'callout-body',
    properties: {},
  }),
}

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
})

export const apiReference = defineDocs({
  dir: 'content/api',
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
})

export default defineConfig({
  mdxOptions: {
    // Fumadocs highlights with Shiki. margelo.com highlights with Prism and
    // styles the `.token` classes it emits, so swap the pipeline wholesale.
    rehypeCodeOptions: false,
    rehypePlugins: (plugins) => [
      // Before Prism: it reads the fence's `meta`, which Prism does not keep.
      rehypeCodeTitles,
      [rehypePrism, { ignoreMissing: true }],
      ...plugins,
    ],
    remarkHeadingOptions: {
      generateToc: true,
    },
    remarkPlugins: [[remarkCallout, remarkCalloutOptions]],
  },
})
