import Image from 'next/image'
import Link from 'next/link'
import { SiteLogo } from '@/components/site-logo'
import { siteConfig } from '@/lib/site-config'

// Layout and buttons follow react-native-vision-camera/docs/src/app/(home)/page.tsx,
// without its camera-viewfinder effects (parallax, focus reticle, thirds grid).
export default function HomePage() {
  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Image
        src="/img/landing-bg-radio-telescopes.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        quality={90}
        className="object-cover object-[30%_center]"
        draggable={false}
      />
      <div className="absolute inset-0 bg-black/30" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 px-6 text-center">
          <h1 className="m-0 w-[min(80vw,460px)]">
            <SiteLogo className="block h-auto w-full text-white" />
          </h1>
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
