export default defineNuxtConfig({
  modules: ['@comark/nuxt', '@nuxt/ui'],
  compatibilityDate: 'latest',

  css: ['~/assets/css/main.css'],

  // ssr: false,

  vite: {
    optimizeDeps: {
      include: [
        // '@nuxt/ui > prosemirror-state',
        // '@nuxt/ui > prosemirror-transform',
        // '@nuxt/ui > prosemirror-model',
        // '@nuxt/ui > prosemirror-view',
        // '@nuxt/ui > prosemirror-gapcursor',
        '@tiptap/core',
        '@tiptap/extension-code-block',
        '@tiptap/extension-document',
        '@tiptap/extension-image',
        '@tiptap/extension-mention',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-table',
        '@tiptap/extension-text',
        '@tiptap/starter-kit',
        '@tiptap/vue-3',
        '@vueuse/core',
        'comark',
        'comark/render',
      ],
    },
  },

  nitro: {
    imports: {},

    replace: {
      'from "consola"': 'from "consola/browser"',
    },
  },
})
