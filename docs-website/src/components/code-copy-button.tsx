'use client'

import { useCallback, useState } from 'react'

export function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!code) return

    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [code])

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Code copied' : 'Copy code'}
      className="absolute top-2 right-2 z-20 inline-flex size-8 items-center justify-center text-fd-muted-foreground transition-colors duration-150 hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 7V4h12v12h-3" />
      <path d="M4 8h12v12H4z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  )
}
