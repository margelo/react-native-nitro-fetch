import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Nitro Fetch',
  tagline: 'Blazing-fast networking for React Native',
  favicon: 'img/logo.png',

  future: {
    v4: true,
  },

  url: 'https://margelo.github.io',
  baseUrl: '/react-native-nitro-fetch/',

  organizationName: 'margelo',
  projectName: 'react-native-nitro-fetch',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  headTags: [
    {
      tagName: 'meta',
      attributes: {
        property: 'og:description',
        content:
          'Drop-in fetch() replacement powered by Cronet & URLSession. HTTP/3, QUIC, prefetching, WebSockets, and worklet mapping.',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'twitter:title',
        content: 'Nitro Fetch — Blazing-fast networking for React Native',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'twitter:description',
        content:
          'Drop-in fetch() replacement powered by Cronet & URLSession. HTTP/3, QUIC, prefetching, WebSockets, and worklet mapping.',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'twitter:image',
        content:
          'https://riteshshukla04.github.io/react-native-nitro-fetch/img/og-image.png',
      },
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/margelo/react-native-nitro-fetch/tree/main/docs-website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/og-image.png',
    navbar: {
      title: 'NITRO FETCH',
      logo: {
        alt: 'Nitro Fetch Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://margelo.com',
          label: 'Hire Us',
          position: 'right',
          className: 'navbar-hire-link',
        },
        {
          'href': 'https://github.com/margelo/react-native-nitro-fetch',
          'position': 'right',
          'className': 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'API Reference', to: '/docs/api' },
            { label: 'WebSockets', to: '/docs/websockets' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/margelo/react-native-nitro-fetch',
            },
            {
              label: 'Margelo',
              href: 'https://margelo.com',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Nitro Modules',
              href: 'https://nitro.margelo.com',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/react-native-nitro-fetch',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Margelo.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['kotlin', 'swift', 'bash', 'json'],
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
