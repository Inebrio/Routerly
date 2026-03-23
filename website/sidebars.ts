import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/providers',
        'concepts/models',
        'concepts/projects',
        'concepts/routing',
        'concepts/budgets-and-limits',
        'concepts/notifications',
      ],
    },
    {
      type: 'category',
      label: 'Dashboard',
      items: [
        'dashboard/setup',
        'dashboard/overview',
        'dashboard/models',
        'dashboard/projects',
        'dashboard/usage',
        'dashboard/users-and-roles',
        'dashboard/settings',
        'dashboard/playground',
        'dashboard/profile',
      ],
    },
    {
      type: 'category',
      label: 'CLI',
      items: [
        'cli/overview',
        'cli/commands',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/overview',
        'api/llm-proxy',
        'api/management',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/self-hosting',
        'guides/client-integration',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/config-files',
        'reference/environment-variables',
        'reference/troubleshooting',
      ],
    },
  ],
};

export default sidebars;
