'use client'

import { useEffect } from 'react'

// Shows the old Nitro Fetch pigeon as the tab icon while the tab is in the background.
export function PigeonFavicon() {
  useEffect(() => {
    const icons = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    )
    const hrefs = icons.map((icon) => icon.href)

    const handleVisibilityChange = () => {
      const isHidden = document.visibilityState === 'hidden'
      icons.forEach((icon, index) => {
        icon.href = isHidden ? '/img/pigeon-icon.png' : hrefs[index]
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
