'use client'

import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { useRef, useState } from 'react'
import { SiteLogo } from '@/components/site-logo'
import oldLogo from '../../../public/img/old-logo.webp'
import pigeon from '../../../public/img/pigeon.webp'

// O ends at 289.6 and F starts at 308.6 in the wordmark's 612.1-unit viewBox.
const GAP_CENTER_PERCENT = (299.1 / 612.1) * 100
const CLICKS_FOR_OLD_LOGO = 4
const CLICK_INTERVAL_MS = 500
const PIGEON_WIDTH = 140

// Easter eggs for the old pigeon logo: hovering between NITRO and FETCH lets
// the pigeon out, and four quick clicks swap the wordmark for the old logo.
export function LandingWordmark() {
  const [showOldLogo, setShowOldLogo] = useState(false)
  const [isPigeonFlying, setIsPigeonFlying] = useState(false)
  const clicksRef = useRef({ count: 0, lastAt: 0 })

  const handleClick = () => {
    const now = performance.now()
    const clicks = clicksRef.current
    clicks.count = now - clicks.lastAt < CLICK_INTERVAL_MS ? clicks.count + 1 : 1
    clicks.lastAt = now

    if (clicks.count === CLICKS_FOR_OLD_LOGO) {
      clicks.count = 0
      setShowOldLogo((current) => !current)
    }
  }

  return (
    <h1
      className="relative m-0 w-[min(80vw,460px)] select-none"
      onClick={handleClick}
    >
      <AnimatePresence mode="wait" initial={false}>
        {showOldLogo ? (
          <motion.div
            key="old-logo"
            className="mx-auto w-[min(50vw,220px)]"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
          >
            <Image
              src={oldLogo}
              alt="Nitro Fetch"
              className="block h-auto w-full rounded-3xl"
              draggable={false}
            />
          </motion.div>
        ) : (
          <motion.div
            key="wordmark"
            className="relative"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
          >
            <SiteLogo
              className="site-landing-wordmark block h-auto w-full overflow-visible text-white"
              data-pigeon={isPigeonFlying || undefined}
            />
            <span
              aria-hidden="true"
              className="absolute -inset-y-4 w-[8%] -translate-x-1/2"
              style={{ left: `${GAP_CENTER_PERCENT}%` }}
              onPointerEnter={() => setIsPigeonFlying(true)}
            />
            {/* Always mounted so the image has loaded before the first flight. */}
            <div
              className="site-landing-pigeon pointer-events-none absolute top-1/2 z-10 opacity-0"
              style={{
                left: `${GAP_CENTER_PERCENT}%`,
                width: PIGEON_WIDTH,
                marginLeft: -PIGEON_WIDTH / 2,
                marginTop: (-PIGEON_WIDTH * pigeon.height) / pigeon.width / 2,
              }}
              data-flying={isPigeonFlying || undefined}
              onAnimationEnd={() => setIsPigeonFlying(false)}
            >
              <Image
                src={pigeon}
                alt=""
                loading="eager"
                className="block h-auto w-full"
                draggable={false}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </h1>
  )
}
