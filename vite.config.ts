import { defineConfig } from 'vite-plus'

const ignorePatterns = [
  '.output/**',
  '.data/**',
  '.nuxt/**',
  '.nitro/**',
  '.cache/**',
  'dist/**',
  'node_modules/**',
  'coverage/**',
  'playwright-report/**',
  'test-results/**',
]

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },

  lint: {
    plugins: ['unicorn', 'typescript', 'oxc', 'vue', 'vitest'],
    options: { typeAware: true, typeCheck: true },
    ignorePatterns,
  },

  fmt: {
    ignorePatterns,
    singleQuote: true,
    quoteProps: 'consistent',
    trailingComma: 'all',
    semi: false,
  },

  staged: {
    '*': 'vp check --fix',
  },

  test: {
    projects: [
      {
        test: {
          name: '@comark/tiptap',
          include: ['lib/comark-tiptap/src/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: '@comark/tiptap-vue',
          include: ['lib/comark-tiptap-vue/src/**/*.{test,spec}.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
    ],
  },
})
