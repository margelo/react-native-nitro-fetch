'use client'

// Copied from react-native-vision-camera/docs/src/components/landing/useParallaxMotion.ts,
// without the container size it tracks for its focus effect.
import { useMotionValue, useSpring } from 'motion/react'
import { type RefObject, useEffect, useRef } from 'react'
import {
  LAYER_SPEEDS,
  PARALLAX_IDLE_RAMP_MS,
  PARALLAX_IDLE_X,
  PARALLAX_IDLE_Y,
  PARALLAX_MAX,
  PARALLAX_MOUSE_OVERRIDE_MS,
  PARALLAX_MULTIPLIER,
  PARALLAX_SPRING,
} from '@/components/landing/constants'

function clamp(value: number, max: number) {
  return Math.max(-max, Math.min(max, value))
}

function easeInOutSine(value: number) {
  return -(Math.cos(Math.PI * value) - 1) / 2
}

function layerOffset(value: number, speed: number) {
  return clamp(value * PARALLAX_MAX * speed * PARALLAX_MULTIPLIER, PARALLAX_MAX)
}

export function useParallaxMotion(
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const mouseRef = useRef({ x: 0, y: 0 })
  const mouseLastMovedAtRef = useRef(0)
  const idleRef = useRef({
    startTime: 0,
  })
  const backXTarget = useMotionValue(0)
  const backYTarget = useMotionValue(0)
  const frontXTarget = useMotionValue(0)
  const frontYTarget = useMotionValue(0)

  const backX = useSpring(backXTarget, PARALLAX_SPRING)
  const backY = useSpring(backYTarget, PARALLAX_SPRING)
  const frontX = useSpring(frontXTarget, PARALLAX_SPRING)
  const frontY = useSpring(frontYTarget, PARALLAX_SPRING)

  useEffect(() => {
    const container = containerRef.current
    if (container == null) {
      return
    }

    let rafId: number | null = null
    let pausedAt: number | null = null

    const animate = (now: number) => {
      const idle = idleRef.current
      const elapsedMs = now - idle.startTime
      const elapsedSeconds = elapsedMs / 1000

      const rampUp = easeInOutSine(
        Math.min(elapsedMs / PARALLAX_IDLE_RAMP_MS, 1),
      )

      const idleX =
        (Math.sin(
          elapsedSeconds * PARALLAX_IDLE_X.a.frequency +
            PARALLAX_IDLE_X.a.phase,
        ) *
          PARALLAX_IDLE_X.a.amplitude +
          Math.sin(
            elapsedSeconds * PARALLAX_IDLE_X.b.frequency +
              PARALLAX_IDLE_X.b.phase,
          ) *
            PARALLAX_IDLE_X.b.amplitude +
          Math.cos(
            elapsedSeconds * PARALLAX_IDLE_X.c.frequency +
              PARALLAX_IDLE_X.c.phase,
          ) *
            PARALLAX_IDLE_X.c.amplitude) *
        rampUp

      const idleY =
        (Math.cos(
          elapsedSeconds * PARALLAX_IDLE_Y.a.frequency +
            PARALLAX_IDLE_Y.a.phase,
        ) *
          PARALLAX_IDLE_Y.a.amplitude +
          Math.sin(
            elapsedSeconds * PARALLAX_IDLE_Y.b.frequency +
              PARALLAX_IDLE_Y.b.phase,
          ) *
            PARALLAX_IDLE_Y.b.amplitude +
          Math.cos(
            elapsedSeconds * PARALLAX_IDLE_Y.c.frequency +
              PARALLAX_IDLE_Y.c.phase,
          ) *
            PARALLAX_IDLE_Y.c.amplitude) *
        rampUp

      const msSinceMouseMove = now - mouseLastMovedAtRef.current
      const blend =
        mouseLastMovedAtRef.current === 0
          ? 0
          : Math.max(0, 1 - msSinceMouseMove / PARALLAX_MOUSE_OVERRIDE_MS)
      const mouse = mouseRef.current

      const combinedX = idleX * (1 - blend) + mouse.x * blend
      const combinedY = idleY * (1 - blend) + mouse.y * blend

      backXTarget.set(layerOffset(combinedX, LAYER_SPEEDS.back))
      backYTarget.set(layerOffset(combinedY, LAYER_SPEEDS.back))
      frontXTarget.set(layerOffset(combinedX, LAYER_SPEEDS.front))
      frontYTarget.set(layerOffset(combinedY, LAYER_SPEEDS.front))

      rafId = requestAnimationFrame(animate)
    }

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouseRef.current.x =
        (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)
      mouseRef.current.y =
        (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)
      mouseLastMovedAtRef.current = performance.now()
    }

    const startAnimationLoop = () => {
      if (rafId != null || document.visibilityState !== 'visible') {
        return
      }

      const now = performance.now()
      if (pausedAt != null) {
        idleRef.current.startTime += now - pausedAt
        pausedAt = null
      } else {
        idleRef.current.startTime = now
      }

      rafId = requestAnimationFrame(animate)
    }

    const stopAnimationLoop = () => {
      if (rafId == null) {
        return
      }

      cancelAnimationFrame(rafId)
      rafId = null
      pausedAt = performance.now()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startAnimationLoop()
        return
      }

      stopAnimationLoop()
    }

    window.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    startAnimationLoop()

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (rafId != null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [backXTarget, backYTarget, containerRef, frontXTarget, frontYTarget])

  return {
    backX,
    backY,
    frontX,
    frontY,
  }
}
