// Follows react-native-vision-camera/docs/src/lib/layout.shared.tsx: a HomeLayout
// top bar above the DocsLayout, with the theme switch and search moved into it.
import type { HomeLayoutProps } from 'fumadocs-ui/layouts/home'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { SiteLogo } from '@/components/site-logo'

export const docsShellClassName = 'site-docs-shell flex flex-col'
export const docsShellHeaderClassName = 'max-md:hidden'

function MargeloBrandIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 30 30"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0V30H30L0 0Z" />
      <path d="M30 0V30L19.007 10.9941L30 0Z" />
    </svg>
  )
}

export function sideBarOptions(): BaseLayoutProps {
  return {
    themeSwitch: {
      enabled: false,
    },
    nav: {
      title: <SiteLogo className="site-mobile-sidebar-logo ml-2 h-3.5 w-auto md:hidden" />,
    },
  }
}

export function homeOptions(): HomeLayoutProps {
  return {
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'API Reference', url: '/api', active: 'nested-url' },
      {
        type: 'icon',
        text: 'Margelo',
        label: 'Margelo',
        url: 'https://margelo.com',
        icon: <MargeloBrandIcon />,
        external: true,
      },
    ],
    githubUrl: 'https://github.com/margelo/react-native-nitro-fetch',
    nav: {
      title: <SiteLogo className="ml-2 h-3.5 w-auto" />,
    },
  }
}
