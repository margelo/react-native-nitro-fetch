'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'
import { IMAGE_LAYER_SCALE } from '@/components/landing/constants'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { ParallaxLayer } from '@/components/landing/ParallaxLayer'
import { useParallaxMotion } from '@/components/landing/useParallaxMotion'
import { siteConfig } from '@/lib/site-config'
import landingBgBack from '../../../public/img/landing-bg-back.webp'
import landingBgFront from '../../../public/img/landing-bg-front.webp'

// Layout, buttons and parallax follow react-native-vision-camera/docs/src/app/(home)/page.tsx,
// without its focus reticle, blur and thirds grid. The front layer is the big dish cut out of the photo.
export default function HomePage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { backX, backY, frontX, frontY } = useParallaxMotion(containerRef)

  return (
    <div ref={containerRef} className="relative h-dvh w-full overflow-hidden">
      <ParallaxLayer x={backX} y={backY}>
        <div
          className="relative h-full w-full"
          style={{ transform: `scale(${IMAGE_LAYER_SCALE})` }}
        >
          <Image
            src={landingBgBack}
            alt=""
            fill
            priority
            sizes="100vw"
            quality={90}
            placeholder="blur"
            className="object-cover object-[30%_center]"
            draggable={false}
          />
        </div>
      </ParallaxLayer>
      <ParallaxLayer x={frontX} y={frontY}>
        <div
          className="relative h-full w-full"
          style={{ transform: `scale(${IMAGE_LAYER_SCALE})` }}
        >
          <Image
            src={landingBgFront}
            alt=""
            fill
            priority
            sizes="100vw"
            quality={90}
            placeholder="blur"
            className="object-cover object-[30%_center]"
            draggable={false}
          />
        </div>
      </ParallaxLayer>
      <div className="absolute inset-0 bg-black/30" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 px-6 text-center">
          <LandingWordmark />
          <p className="m-0 text-lg text-white/90 md:text-xl">
            {siteConfig.tagline}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs"
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              Get Started
            </Link>
            <Link
              href="/api"
              className="rounded-full bg-black/60 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black/70"
            >
              API Reference
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
