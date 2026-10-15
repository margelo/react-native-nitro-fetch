// Follows react-native-vision-camera/docs/src/lib/mdx/callouts.tsx, without its
// `dependency` callout type.
import {
  CalloutContainer,
  CalloutDescription,
  CalloutTitle,
} from 'fumadocs-ui/components/callout'
import type { ComponentProps, ReactNode } from 'react'

type MdxCalloutRootProps = ComponentProps<typeof CalloutContainer> & {
  type?: string
}

type MdxCalloutTitleProps = ComponentProps<typeof CalloutTitle> & {
  type?: string
}

function resolveCalloutType(
  type: string | undefined,
): ComponentProps<typeof CalloutContainer>['type'] | undefined {
  switch (type?.toLowerCase()) {
    case 'info':
      return 'info'
    case 'warn':
      return 'warn'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'success':
      return 'success'
    case 'idea':
      return 'idea'
    default:
      return undefined
  }
}

export function MdxCalloutContainer({
  type,
  ...props
}: MdxCalloutRootProps): ReactNode {
  return <CalloutContainer {...props} type={resolveCalloutType(type)} />
}

export function MdxCalloutTitle({
  type: _type,
  ...props
}: MdxCalloutTitleProps): ReactNode {
  return <CalloutTitle {...props} />
}

export { CalloutDescription as MdxCalloutBody }
