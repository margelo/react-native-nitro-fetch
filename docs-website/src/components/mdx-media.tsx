import type { CSSProperties, ImgHTMLAttributes, ReactNode } from 'react'

type ImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  maxWidth?: CSSProperties['maxWidth']
}

export function Img({ src, alt, maxWidth, style, ...props }: ImgProps) {
  return (
    // biome-ignore lint/performance/noImgElement: docs images have no build-time dimensions to hand next/image.
    <img
      {...props}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      style={{
        height: 'auto',
        ...style,
        ...(maxWidth ? { marginInline: 'auto', maxWidth } : null),
      }}
    />
  )
}

export function Video({
  src,
  title,
  maxWidth,
}: {
  src: string
  title?: string
  maxWidth?: string
}) {
  return (
    <figure
      className="my-8 w-full"
      style={maxWidth ? { marginInline: 'auto', maxWidth } : undefined}
    >
      <video
        className="site-media bg-black"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        src={src}
        aria-label={title?.trim() || 'Embedded video'}
      />
      {title?.trim() && <figcaption className="site-caption">{title}</figcaption>}
    </figure>
  )
}

export function VideoAside({
  src,
  title,
  maxWidth = '320px',
  side,
  children,
}: {
  src: string
  title?: string
  maxWidth?: string
  side?: 'left' | 'right'
  children: ReactNode
}) {
  const reversed = side === 'left'

  return (
    <div
      className={`my-8 flex flex-col gap-5 md:gap-6 ${
        reversed ? 'md:flex-row-reverse' : 'md:flex-row'
      }`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <figure
        className="mx-auto w-full shrink-0 md:mx-0 md:w-[var(--aside-width)]"
        style={{ '--aside-width': maxWidth } as CSSProperties}
      >
        <video
          className="site-media bg-black"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          src={src}
          aria-label={title?.trim() || 'Embedded video'}
        />
        {title?.trim() && (
          <figcaption className="site-caption">{title}</figcaption>
        )}
      </figure>
    </div>
  )
}

export function YouTube({
  id,
  title = 'YouTube video',
}: {
  id: string
  title?: string
}) {
  return (
    <div className="site-media relative my-8 aspect-video overflow-hidden">
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}
