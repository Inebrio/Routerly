import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Routerly',
  tagline: 'One gateway. Any AI model. Total control.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://doc.routerly.ai',
  baseUrl: '/',

  organizationName: 'Inebrio',
  projectName: 'Routerly',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  headTags: [
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    },
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
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
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Inebrio/Routerly/edit/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Routerly',
      logo: {
        alt: 'Routerly Logo',
        src: 'img/favicon.svg',
        srcDark: 'img/favicon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/Inebrio/Routerly',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Get Started',
          items: [
            { label: 'Installation', to: '/getting-started/installation' },
            { label: 'Quick Start', to: '/getting-started/quick-start' },
            { label: 'Configuration', to: '/getting-started/configuration' },
          ],
        },
        {
          title: 'Documentation',
          items: [
            { label: 'Routing Policies', to: '/concepts/routing' },
            { label: 'Budgets & Limits', to: '/concepts/budgets-and-limits' },
            { label: 'API Reference', to: '/api/overview' },
            { label: 'CLI Commands', to: '/cli/commands' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/Inebrio/Routerly' },
            { label: 'routerly.ai', href: 'https://www.routerly.ai/' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Routerly. AGPL-3.0 License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'python', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
