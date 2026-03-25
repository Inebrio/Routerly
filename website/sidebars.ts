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
      label: 'Integrations',
      items: [
        'integrations/overview',
        {
          type: 'category',
          label: 'Chat UI',
          items: [
            'integrations/open-webui',
            'integrations/librechat',
            'integrations/openclaw',
          ],
        },
        {
          type: 'category',
          label: 'IDE & Editor',
          items: [
            'integrations/cursor',
            'integrations/continue',
            'integrations/cline',
            'integrations/vscode',
          ],
        },
        {
          type: 'category',
          label: 'Frameworks',
          items: [
            'integrations/langchain',
            'integrations/llamaindex',
            'integrations/haystack',
          ],
        },
        {
          type: 'category',
          label: 'Automation',
          items: [
            'integrations/n8n',
            'integrations/make',
            'integrations/zapier',
          ],
        },
        {
          type: 'category',
          label: 'Notebooks',
          items: [
            'integrations/jupyter',
            'integrations/marimo',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/overview',
        'examples/javascript',
        'examples/python',
        'examples/java',
        'examples/go',
        'examples/dotnet',
        'examples/php',
        'examples/ruby',
        'examples/rust',
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
