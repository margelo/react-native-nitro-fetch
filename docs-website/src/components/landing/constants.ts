// Parallax values copied from react-native-vision-camera/docs/src/components/landing/constants.ts.
export const PARALLAX_MAX = 5
export const PARALLAX_IDLE_RAMP_MS = 3000
export const PARALLAX_MOUSE_OVERRIDE_MS = 1200
export const PARALLAX_MULTIPLIER = 25
export const IMAGE_OVERSCAN_PERCENT = 2
export const IMAGE_LAYER_SCALE = 1.05
export const PARALLAX_SPRING = {
  stiffness: 80,
  damping: 22,
  mass: 0.8,
} as const
export const PARALLAX_IDLE_X = {
  a: { amplitude: 0.85, frequency: 0.42, phase: 0 },
  b: { amplitude: 0.55, frequency: 0.19, phase: 1.2 },
  c: { amplitude: 0.3, frequency: 0.11, phase: 0.4 },
} as const
export const PARALLAX_IDLE_Y = {
  a: { amplitude: 0.7, frequency: 0.33, phase: 0.7 },
  b: { amplitude: 0.45, frequency: 0.17, phase: 2.1 },
  c: { amplitude: 0.25, frequency: 0.09, phase: 1.4 },
} as const
export const LAYER_SPEEDS = {
  back: 0.02,
  front: 0.08,
} as const
