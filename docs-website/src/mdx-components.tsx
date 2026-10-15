import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { isValidElement } from 'react'
import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react'
import { CodeCopyButton } from '@/components/code-copy-button'
import { LANG_LABELS } from '@/lib/lang-labels'
import {
  MdxCalloutBody,
  MdxCalloutContainer,
  MdxCalloutTitle,
} from '@/components/callouts'
import { Img, Video, VideoAside, YouTube } from '@/components/mdx-media'

const LANGUAGE_CLASS_RE = /(?:^|\s)(?:language|lang)-([a-z0-9+#.-]+)(?:\s|$)/i

function getCodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getCodeText).join('')
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getCodeText(node.props.children)
  }

  return ''
}

function CodeBlock({
  children,
  className,
  'data-code-title': codeTitle,
  ...props
}: HTMLAttributes<HTMLPreElement> & { 'data-code-title'?: string }) {
  const rawLang = className?.match(LANGUAGE_CLASS_RE)?.[1]?.toLowerCase()
  const languageLabel = rawLang
    ? (LANG_LABELS[rawLang] ?? (rawLang === 'text' ? undefined : rawLang))
    : undefined
  const label = codeTitle?.trim() || languageLabel
  const code = getCodeText(children).replace(/\n$/, '')

  return (
    <div className="site-code-block">
      {label && <span className="site-code-block__label">{label}</span>}
      <CodeCopyButton code={code} />
      <pre {...props} className={className} tabIndex={0}>
        {children}
      </pre>
    </div>
  )
}

function Table(props: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div
      className="my-6 w-full overflow-x-auto rounded-xl border border-[var(--site-rule)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
      tabIndex={0}
    >
      <table {...props} />
    </div>
  )
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    pre: CodeBlock,
    table: Table,
    img: Img,
    Img,
    Video,
    VideoAside,
    YouTube,
    'callout-root': MdxCalloutContainer,
    'callout-title': MdxCalloutTitle,
    'callout-body': MdxCalloutBody,
  }
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
