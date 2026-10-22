// Fumadocs requires a `title` on every page. Follows the MarkdownPageEvent.BEGIN
// hook in react-native-vision-camera/docs/scripts/typedoc-frontmatter.mts:247.
import { MarkdownPageEvent } from 'typedoc-plugin-markdown'

function firstSentence(summary) {
  const text = summary
    .map((part) => part.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const end = text.search(/\.(\s|$)/)
  return end === -1 ? text : text.slice(0, end + 1)
}

export function load(app) {
  app.renderer.on(MarkdownPageEvent.BEGIN, (page) => {
    const model = page.model
    const summary =
      model.comment?.summary ?? model.signatures?.[0]?.comment?.summary
    const description =
      summary != null && summary.length > 0 ? firstSentence(summary) : undefined

    page.frontmatter = {
      ...page.frontmatter,
      title: model.name,
      ...(description ? { description } : {}),
    }
  })
}
