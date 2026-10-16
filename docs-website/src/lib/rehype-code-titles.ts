/**
 * Ported from margelo.com/src/utils/rehype-code-titles.ts.
 *
 * Reads a ```ts title="metro.config.js" fence and puts the title on the `pre`
 * as `data-code-title`, which the code block renders in place of the language
 * label.
 */
type HastElement = {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  data?: { meta?: unknown }
  children?: HastNode[]
}

type HastNode = HastElement | { type?: string; children?: HastNode[] }

const CODE_TITLE_RE = /(?:^|\s)title=(?:"([^"]+)"|'([^']+)')(?=\s|$)/

function visit(node: HastNode): void {
  const element = node as HastElement

  if (element.type === 'element' && element.tagName === 'pre') {
    const code = element.children?.find(
      (child): child is HastElement =>
        child.type === 'element' && (child as HastElement).tagName === 'code',
    )
    const meta = code?.data?.meta

    if (typeof meta === 'string') {
      const match = meta.match(CODE_TITLE_RE)
      const title = (match?.[1] ?? match?.[2])?.trim()

      if (title) {
        element.properties ??= {}
        element.properties['data-code-title'] = title
      }
    }
  }

  if (Array.isArray(element.children)) {
    for (const child of element.children) visit(child)
  }
}

export function rehypeCodeTitles() {
  return (tree: HastNode) => {
    visit(tree)
  }
}
