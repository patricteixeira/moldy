import type { ContentSpec, LayoutSpec, ShapeLayer, Slot } from "../api/types"

export function materializeContentLayout(
  layout: LayoutSpec,
  content: Pick<ContentSpec, "addedSlots" | "addedLayers">,
): LayoutSpec {
  return {
    ...layout,
    slots: [...layout.slots, ...(content.addedSlots ?? [])] as Slot[],
    lockedLayers: [
      ...(layout.lockedLayers ?? []),
      ...((content.addedLayers ?? []) as ShapeLayer[]),
    ],
  }
}
