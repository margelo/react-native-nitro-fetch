import type { MotionValue } from 'motion/react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { IMAGE_OVERSCAN_PERCENT } from '@/components/landing/constants'

// react-native-vision-camera/docs/src/components/landing/ParallaxBlurLayer.tsx without the blur.
type ParallaxLayerProps = {
  children: ReactNode
  x: MotionValue<number>
  y: MotionValue<number>
}

export function ParallaxLayer({ children, x, y }: ParallaxLayerProps) {
  return (
    <motion.div
      className="site-landing-parallax-layer pointer-events-none absolute"
      style={{
        top: `-${IMAGE_OVERSCAN_PERCENT}%`,
        right: `-${IMAGE_OVERSCAN_PERCENT}%`,
        bottom: `-${IMAGE_OVERSCAN_PERCENT}%`,
        left: `-${IMAGE_OVERSCAN_PERCENT}%`,
        x,
        y,
      }}
    >
      {children}
    </motion.div>
  )
}
