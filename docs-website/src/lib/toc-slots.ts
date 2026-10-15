import {
  TOCPopover,
  TOCProvider,
} from 'fumadocs-ui/layouts/docs/page/slots/toc'
import { SiteTOC } from '@/components/site-toc'

// Desktop TOC replaced; fumadocs' provider and mobile popover kept.
export const tocSlots = {
  toc: { provider: TOCProvider, main: SiteTOC, popover: TOCPopover },
}
