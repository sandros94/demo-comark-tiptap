declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const Component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default Component
}
