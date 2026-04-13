import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'getting-started',
    {
      type: 'category',
      label: 'Core',
      collapsed: false,
      items: [
        'api',
        'prefetch',
        'streaming',
        'abort-controller',
        'form-data',
        'token-refresh',
      ],
    },
    'websockets',
    {
      type: 'category',
      label: 'Advanced',
      items: ['worklets', 'inspection', 'global-replace'],
    },
    'skills',
    'troubleshooting',
  ],
};

export default sidebars;
