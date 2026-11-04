import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsRoot, '..')

/** @type {Partial<import('typedoc').TypeDocOptions & import('typedoc-plugin-markdown').PluginOptions>} */
const config = {
  name: 'API Reference',
  entryPointStrategy: 'packages',
  entryPoints: [
    path.join(repoRoot, 'packages', 'react-native-nitro-fetch'),
    path.join(repoRoot, 'packages', 'react-native-nitro-websockets'),
    path.join(repoRoot, 'packages', 'react-native-nitro-text-decoder'),
  ],
  packageOptions: {
    // react-native-nitro-fetch's entry is index.tsx; the other two use index.ts.
    // TypeDoc finds the folder to search from `*`, not from `{a,b}`.
    entryPoints: ['src/index.ts*'],
    // Each package is converted with only these options, so a root-level
    // skipErrorChecking would not reach it.
    skipErrorChecking: true,
    readme: 'none',
    excludePrivate: true,
    excludeProtected: true,
    excludeExternals: true,
    excludeInternal: true,
    disableSources: true,
  },
  plugin: [
    'typedoc-plugin-markdown',
    'typedoc-plugin-frontmatter',
    path.join(docsRoot, 'scripts', 'typedoc-frontmatter.mjs'),
  ],
  out: path.join(docsRoot, 'content', 'api'),
  readme: 'none',
  skipErrorChecking: true,
  fileExtension: '.mdx',
  entryFileName: 'index',
  useCodeBlocks: true,
  expandParameters: true,
  hidePageHeader: true,
  hidePageTitle: true,
  hideBreadcrumbs: true,
  blockTags: ['@note', '@discussion', '@defaultValue', '@example', '@see', '@throws', '@param', '@returns'],
}

export default config
