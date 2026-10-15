# Documentation site

The fetch.margelo.com website. [Next.js](https://nextjs.org) App Router with
[fumadocs](https://fumadocs.dev), built the same way as the react-native-mnn
documentation site.

Run these from this folder:

```bash
bun install
bun run dev          # http://localhost:3000
bun run build        # production build
bun run types:check  # tsc --noEmit
```

## Layout

- `content/docs/` - the pages. Each `(section)` folder is a collapsible
  sidebar section, and its `meta.json` sets the title and page order. The
  parentheses keep the folder name out of the URL.
- `content/api/` - the API reference, generated from the packages' TSDoc
  comments by `bun run docs:api`. It is not committed.
- `src/app/(home)/page.tsx` - the landing page.
- `src/app/(content)/docs/[[...slug]]/page.tsx` - the page route.
- `src/mdx-components.tsx` - the MDX component map, including the code block.
- `src/components/mdx-media.tsx` - `Video`, `VideoAside`, `YouTube`, `Img` and
  `Callout`.
- `src/components/site-logo.tsx` - the wordmark.
- `src/app/global.css` - fumadocs theme variables, prose styles, code block
  tokens, table of contents.

## Styling

Every color is a CSS variable defined for both themes in `src/app/global.css`.
Orange is the only accent.

Code is highlighted by Prism, not by fumadocs' own Shiki pipeline.
`source.config.ts` sets `rehypeCodeOptions: false` and adds
`rehype-prism-plus` in its place. Changing the highlighter means rewriting the
token colors in `global.css`.

The landing page photo is by Yifu Wu on
[Unsplash](https://unsplash.com/photos/7vnXRYujDig).
