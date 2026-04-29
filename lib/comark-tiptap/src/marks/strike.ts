import { Mark, mergeAttributes } from '@tiptap/core'
import { mergeAttrs, splitAttrs } from '../utils/attrs'
import { htmlAttrSpec } from '../utils/html-attrs'
import type { ComarkElement, ComarkNode, MarkSpec, PMMark } from '../types'

export const strikeSpec: MarkSpec = {
  pmName: 'strike',
  tags: ['s', 'del'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const attrs = mergeAttrs(
      {},
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['del', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { htmlAttrs } = splitAttrs(el[1], [])
    return Object.keys(htmlAttrs).length > 0
      ? { type: 'strike', attrs: { htmlAttrs } }
      : { type: 'strike' }
  },
}

export const ComarkStrike = Mark.create({
  name: 'strike',

  addAttributes() {
    return { ...htmlAttrSpec() }
  },

  parseHTML() {
    // Inbound: tolerate every shape an external editor or pasted HTML might
    // produce. Outbound is canonicalised to `<del>` (see `renderHTML`).
    return [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration=line-through' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Render `<del>` to match Comark's canonical strikethrough tag — the
    // parser normalises `~~…~~` and `<s>` to `del`, so aligning the DOM
    // output keeps PM ↔ DOM ↔ Comark all on the same tag.
    return ['del', mergeAttributes(HTMLAttributes), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-s': () => this.editor.commands.toggleMark(this.name),
      'Mod-Shift-S': () => this.editor.commands.toggleMark(this.name),
    }
  },

  addStorage() {
    return { comark: strikeSpec }
  },
})
