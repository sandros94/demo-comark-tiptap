import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Tiptap node for Comark comments (`<!-- … -->`). The Comark serializer
 * handles the `text` round-trip; this extension is the schema slot.
 *
 * `htmlAttrs` is added by the global `ComarkAttrs` extension, so we only
 * need to declare the comment's own `text` payload here.
 */
export const ComarkComment = Node.create({
  name: 'comarkComment',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // `data-comark-comment` doubles as both the marker (so
      // `parseHTML`'s attribute selector matches) and the payload —
      // emitting it unconditionally avoids the previous bug where the
      // node-level `renderHTML` overwrote a non-empty payload with an
      // empty marker via `mergeAttributes` last-wins semantics.
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-comark-comment') ?? '',
        renderHTML: (attrs) => ({
          'data-comark-comment': typeof attrs.text === 'string' ? attrs.text : '',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-comark-comment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)]
  },
})
