import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const PWA_THEME_COLOR = '#0a0f1e'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const enablePwa = env.VITE_ENABLE_PWA !== 'false'

  const plugins = [react()]

  plugins.push(
    VitePWA({
      disable: !enablePwa,
      registerType: 'autoUpdate',
        includeAssets: ['pwa-icon.svg', 'icons.svg', 'offline.html'],
        manifest: {
          name: 'Party Games',
          short_name: 'Party Games',
          description: 'Imprezowe gry multiplayer — pokoje, QR, wiele gier.',
          theme_color: PWA_THEME_COLOR,
          background_color: PWA_THEME_COLOR,
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'pl',
          icons: [
            {
              src: 'pwa-icon.svg',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'pwa-icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
          navigateFallback: '/offline.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pages',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 8 },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/.*\.firebaseio\.com\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/.*\.firebasedatabase\.app\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
  )

  return {
    plugins,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase')) return 'firebase'
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react'
            if (id.includes('node_modules/qrcode.react')) return 'qrcode'
          },
        },
      },
    },
  }
})
