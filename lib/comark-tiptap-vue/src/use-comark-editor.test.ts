/**
 * Coverage for `useComarkEditor` — the Vue-layer composable that wraps
 * a Tiptap `Editor` configured with `ComarkKit`. Covers every seed
 * flavor (AST / markdown string / PM JSON), every imperative setter,
 * and the unmount-cleanup contract.
 *
 * The composable uses `onMounted` / `onBeforeUnmount`, so each test
 * mounts a tiny Vue component that calls the composable in `setup`
 * and exposes the return value through a captured closure variable. We
 * avoid `@vue/test-utils` because it isn't a project dep — the manual
 * `createApp` mount is small and the assertions don't need the extra
 * surface area.
 */

import type { Editor, JSONContent } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import type { ComarkTree } from '@comark/tiptap'
import {
  useComarkEditor,
  type UseComarkEditorOptions,
  type UseComarkEditorReturn,
} from './use-comark-editor'

/** Wait for the editor's next `update` event. */
function nextUpdate(editor: Editor, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (): void => {
      editor.off('update', handler)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      editor.off('update', handler)
      reject(new Error(`Editor 'update' did not fire within ${timeoutMs}ms`))
    }, timeoutMs)
    editor.on('update', handler)
  })
}

async function flushVueLifecycle(): Promise<void> {
  await nextTick()
}

const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

interface Mounted {
  app: App
  container: HTMLElement
  result: UseComarkEditorReturn
}

/**
 * Mount a synthetic component that calls `useComarkEditor(options)` and
 * exposes the return value. We don't render anything visible — the
 * editor doesn't need to be attached to a viewport for its commands
 * and storage to work in happy-dom.
 *
 * Implementation note: stash the return on a closure-scoped `let`
 * rather than a `ref` because `ref<{ editor: ShallowRef<...> }>` would
 * proxy through `reactive` and silently unwrap the nested refs at read
 * time — `m.result.editor.value` then yields `undefined` even after
 * the editor has constructed. `let` keeps the refs as refs.
 */
function mount(options: UseComarkEditorOptions): Mounted {
  let captured: UseComarkEditorReturn | null = null
  const Comp = defineComponent({
    setup() {
      captured = useComarkEditor(options)
      return () => h('div', { 'data-test': 'editor-host' })
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(Comp)
  app.mount(container)
  if (!captured) throw new Error('useComarkEditor never ran (component setup not invoked)')
  return { app, container, result: captured }
}

const live: Mounted[] = []
beforeEach(() => {
  live.length = 0
})
afterEach(() => {
  while (live.length) {
    const m = live.pop()!
    m.app.unmount()
    m.container.remove()
  }
})
function track(m: Mounted): Mounted {
  live.push(m)
  return m
}

function getDoc(editor: Editor): JSONContent {
  return editor.getJSON() as JSONContent
}

describe('useComarkEditor — initial seed', () => {
  it('mounts with a markdown string seed and parses it via the Comark pipeline', async () => {
    const m = track(mount({ initial: '# Hello\n\nbody **strong**.\n' }))

    // Two waits: Vue's scheduler has to flush so `onMounted` runs and
    // `editor.value` is assigned, then the parsed-markdown seed lands
    // when the editor fires its first `update` event.
    await flushVueLifecycle()
    await nextUpdate(m.result.editor.value!)

    expect(m.result.isReady.value).toBe(true)
    const json = m.result.editor.value!.getJSON() as JSONContent
    const blocks = json.content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.attrs?.level).toBe(1)
    expect(blocks[1]?.type).toBe('paragraph')
  })

  it('mounts with a Comark AST seed and applies it via setComarkAst', async () => {
    const tree: ComarkTree = {
      nodes: [
        ['h2', {}, 'AST seed'],
        ['p', {}, 'inline'],
      ],
      frontmatter: { title: 't' },
      meta: { x: 1 },
    }
    const m = track(mount({ initial: tree }))

    // AST seed is applied via `setComarkAst({ emitUpdate: false })`
    // from inside `onMounted` — synchronous, no editor `update` event
    // fires. Just flush Vue's lifecycle to make `editor.value`
    // available.
    await flushVueLifecycle()

    const blocks = m.result.editor.value!.getJSON().content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.attrs?.level).toBe(2)
    // The ComarkSerializer copies frontmatter / meta into storage so
    // round-tripping back to AST recovers them.
    expect(m.result.editor.value!.storage.comark.frontmatter).toEqual({ title: 't' })
    expect(m.result.editor.value!.storage.comark.meta).toEqual({ x: 1 })
  })

  it('mounts with a PM JSON seed and applies it synchronously', async () => {
    const json: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'preset' }] }],
    }
    const m = track(mount({ initial: json }))

    await flushVueLifecycle()

    expect(getDoc(m.result.editor.value!).content?.[0]?.content?.[0]?.text).toBe('preset')
  })

  it('mounts with no seed and exposes an empty doc', async () => {
    const m = track(mount({}))

    await flushVueLifecycle()

    const blocks = m.result.editor.value!.getJSON().content ?? []
    // StarterKit's TrailingNode adds a trailing empty paragraph; an
    // empty doc therefore has at least one block (the trailing one).
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]?.type).toBe('paragraph')
  })
})

describe('useComarkEditor — imperative setters', () => {
  it('setMarkdown replaces content with a parsed markdown string', async () => {
    const m = track(mount({ initial: 'first paragraph\n' }))
    await flushVueLifecycle()
    const editor = m.result.editor.value!
    await nextUpdate(editor) // seed lands

    await m.result.setMarkdown('## Replaced\n\n- a\n- b\n')
    await nextUpdate(editor) // replace lands

    const blocks = editor.getJSON().content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[1]?.type).toBe('bulletList')
  })

  it('setAst replaces content with a Comark tree', async () => {
    const m = track(mount({ initial: '' }))
    await flushVueLifecycle()

    m.result.setAst({
      nodes: [['h3', {}, 'set via AST']],
      frontmatter: {},
      meta: {},
    })

    // `setComarkAst` chains through Tiptap commands synchronously once
    // the AST is known — no async parse required.
    const blocks = m.result.editor.value!.getJSON().content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.attrs?.level).toBe(3)
  })

  it('setJson replaces content with PM JSON', async () => {
    const m = track(mount({ initial: 'starter\n' }))
    await flushVueLifecycle()
    // Wait for the markdown seed to land before replacing — otherwise
    // a late seed update could clobber our explicit setJson.
    await nextUpdate(m.result.editor.value!)

    m.result.setJson({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'JSON' }] },
      ],
    })

    const blocks = getDoc(m.result.editor.value!).content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.content?.[0]?.text).toBe('JSON')
  })

  it('functional setMarkdown receives current content for derivation', async () => {
    const m = track(mount({ initial: '# Original\n' }))
    await flushVueLifecycle()
    const editor = m.result.editor.value!
    await nextUpdate(editor) // seed lands

    await m.result.setMarkdown(({ content }) => `${content.trimEnd()}\n\nappended\n`)
    await nextUpdate(editor) // functional update lands

    const blocks = getDoc(editor).content ?? []
    expect(blocks[0]?.type).toBe('heading')
    // Find the appended paragraph (might not be last because of
    // TrailingNode's empty paragraph).
    const appended = blocks.find(
      (b) => b.type === 'paragraph' && (b.content ?? [])[0]?.text === 'appended',
    )
    expect(appended).toBeDefined()
  })

  it('setHtml replaces content with HTML through the stock pipeline (synchronous)', async () => {
    const m = track(mount({ initial: '' }))
    await flushVueLifecycle()

    m.result.setHtml('<h2>Set via HTML</h2>')

    // Synchronous — no `nextUpdate` needed because the HTML escape
    // hatch bypasses comark.parse and runs `baseSetContent` directly.
    const blocks = m.result.editor.value!.getJSON().content ?? []
    expect(blocks[0]?.type).toBe('heading')
    expect(blocks[0]?.attrs?.level).toBe(2)
  })
})

describe('useComarkEditor — getters', () => {
  it('getAst / getMarkdown / getJson / getHtml read the current content', async () => {
    const m = track(mount({ initial: '# Hi\n' }))
    await flushVueLifecycle()
    await nextUpdate(m.result.editor.value!)

    const ast = m.result.getAst()
    expect(ast).not.toBeNull()
    expect(ast!.nodes[0]).toBeDefined()

    const md = await m.result.getMarkdown()
    expect(md).not.toBeNull()
    expect(md!.trimEnd()).toContain('# Hi')

    const json = m.result.getJson()
    expect(json?.type).toBe('doc')
    expect(json?.content?.[0]?.type).toBe('heading')

    const html = m.result.getHtml()
    expect(html).not.toBeNull()
    expect(html!).toContain('<h1')
    expect(html!).toContain('Hi')
  })
})

describe('useComarkEditor — lifecycle hooks', () => {
  it('fires onCreate exactly once with the editor instance', async () => {
    const calls: unknown[] = []
    track(
      mount({
        initial: '# x\n',
        onCreate: (e) => calls.push(e),
      }),
    )
    // Tiptap dispatches its own `create` event asynchronously via
    // `setTimeout(0)` inside the constructor — so onCreate doesn't run
    // until a macrotask boundary, which `flushMicrotasks` provides.
    // `flushVueLifecycle` alone (a microtask flush) isn't enough here.
    await flushVueLifecycle()
    await flushMicrotasks()

    expect(calls).toHaveLength(1)
    expect((calls[0] as { state: unknown }).state).toBeDefined()
  })

  it('fires onUpdate when content changes via setMarkdown', async () => {
    const calls: number[] = []
    const m = track(
      mount({
        initial: '# x\n',
        onUpdate: () => calls.push(Date.now()),
      }),
    )
    await flushVueLifecycle()
    const editor = m.result.editor.value!
    await nextUpdate(editor) // seed update — counts as one
    const baseline = calls.length

    await m.result.setMarkdown('# y\n')
    await nextUpdate(editor) // replace update

    expect(calls.length).toBeGreaterThan(baseline)
  })

  it('destroys the editor on unmount', async () => {
    const m = mount({ initial: '# x\n' })
    await flushVueLifecycle()
    const editor = m.result.editor.value!
    expect(editor.isDestroyed).toBe(false)

    m.app.unmount()
    m.container.remove()

    expect(editor.isDestroyed).toBe(true)
  })
})
