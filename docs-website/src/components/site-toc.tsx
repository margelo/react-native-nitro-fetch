'use client'

import { useTOCItems } from 'fumadocs-ui/components/toc'
import { Text } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const ACTIVE_OFFSET = 110
// A heading also counts once it is in the top part of the window, so the one
// just below the top bar, which the reader is on, takes the highlight.
const ACTIVE_VIEWPORT_FRACTION = 0.4

// Ported from margelo.com/src/app/blog/[slug]/BlogTableOfContents.tsx. Pinning a
// clicked link is new here: a heading near the end of the page can never scroll
// to the top, so scroll position alone keeps an earlier section highlighted.
function useActiveSection(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const pinnedRef = useRef<string | null>(null)

  useEffect(() => {
    if (ids.length === 0) return

    const update = () => {
      if (pinnedRef.current != null) return
      const scrollY =
        window.scrollY +
        Math.max(ACTIVE_OFFSET, window.innerHeight * ACTIVE_VIEWPORT_FRACTION)
      let current: string | null = null

      for (const id of ids) {
        const element = document.getElementById(id)
        if (!element) continue

        const top = element.getBoundingClientRect().top + window.scrollY
        if (top <= scrollY) current = id
      }

      setActiveId(current ?? ids[0] ?? null)
    }

    // Only reader input unpins; the scroll a click triggers must not.
    const unpin = () => {
      pinnedRef.current = null
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.addEventListener('wheel', unpin, { passive: true })
    window.addEventListener('touchstart', unpin, { passive: true })
    window.addEventListener('keydown', unpin)

    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('wheel', unpin)
      window.removeEventListener('touchstart', unpin)
      window.removeEventListener('keydown', unpin)
    }
  }, [ids])

  const pin = (id: string) => {
    pinnedRef.current = id
    setActiveId(id)
  }

  return [activeId, pin] as const
}

export function SiteTOC() {
  const items = useTOCItems()
  const ids = useMemo(() => items.map((item) => item.url.slice(1)), [items])
  const [activeId, pin] = useActiveSection(ids)

  if (items.length === 0) {
    return (
      <div
        id="nd-toc-placeholder"
        className="hidden xl:layout:[--fd-toc-width:268px]"
      />
    )
  }

  return (
    <div
      id="nd-toc"
      className="sticky top-(--fd-docs-row-1) flex h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] w-(--fd-toc-width) flex-col pt-12 pe-4 pb-2 [grid-area:toc] max-xl:hidden xl:layout:[--fd-toc-width:268px]"
    >
      <h3
        id="toc-title"
        className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground"
      >
        <Text className="size-4" />
        On this page
      </h3>
      <nav
        aria-label="Table of contents"
        className="mt-3 flex flex-col overflow-y-auto"
      >
        {items.map((item) => {
          const id = item.url.slice(1)
          return (
            <a
              key={item.url}
              href={item.url}
              data-active={activeId === id}
              onClick={() => pin(id)}
              style={
                item.depth > 2
                  ? { paddingInlineStart: `${0.75 * (item.depth - 1)}rem` }
                  : undefined
              }
            >
              {item.title}
            </a>
          )
        })}
      </nav>

      {/* From the blog's BlogTableOfContents.tsx, recolored through theme variables. */}
      <div className="mt-8 shrink-0 rounded-xl border border-[var(--site-rule)] p-4">
        <p className="mb-1 font-sans text-[0.8125rem] font-semibold leading-5 text-[var(--site-prose-heading)]">
          Building something ambitious?
        </p>
        <p className="mb-4 font-sans text-xs leading-5 text-fd-muted-foreground">
          We help teams ship world-class React Native apps.
        </p>
        <a
          href="https://margelo.com/#contact"
          className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--site-button-bg)] px-4 py-2.5 font-sans text-[0.8125rem] font-medium text-[var(--site-button-fg)] no-underline transition-opacity duration-200 hover:opacity-90"
        >
          Let&apos;s talk
        </a>
      </div>
    </div>
  )
}
