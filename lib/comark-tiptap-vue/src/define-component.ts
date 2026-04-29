import { VueNodeViewRenderer } from '@tiptap/vue-3'
import {
  defineComarkComponent,
  type ComarkComponentDefinition,
  type ComarkComponentExports,
} from '@comark/tiptap'
import type { Component } from 'vue'

/**
 * Vue-typed `ComarkComponentDefinition`. The `nodeView` field is narrowed
 * to a Vue SFC / functional component; receives Tiptap's standard NodeView
 * props (`node`, `updateAttributes`, `editor`, …) at runtime.
 */
export type ComarkVueComponentDefinition = ComarkComponentDefinition<Component>

/**
 * Vue-typed `ComarkComponentExports`. Structurally identical to the
 * framework-agnostic `ComarkComponentExports<Component>`, but the runtime
 * `extension` returned from `defineComarkVueComponent` has `addNodeView`
 * extended with a `VueNodeViewRenderer` when a `nodeView` was provided.
 */
export type ComarkVueComponentExports = ComarkComponentExports<Component>

export function defineComarkVueComponent(
  def: ComarkVueComponentDefinition,
): ComarkVueComponentExports {
  // Build the framework-agnostic part first — it produces the schema and
  // the serialization spec. We then extend the resulting Tiptap Node with
  // `addNodeView` so the Vue SFC takes over rendering.
  const base = defineComarkComponent<Component>(def)

  if (!def.nodeView) return base

  const nodeView = def.nodeView
  // `.extend()` only adds an `addNodeView` config; the storage type from
  // `base.extension` (which already carries `{ comark: NodeSpec }`) is
  // preserved through the call, so no cast is needed.
  const extension = base.extension.extend({
    addNodeView() {
      return VueNodeViewRenderer(nodeView)
    },
  })

  return { ...base, extension }
}
