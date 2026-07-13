export function chooseFontSize(
  measure: (sizePx: number) => number,
  boxPx: number,
  minPx: number,
  maxPx: number,
): number {
  for (let size = Math.floor(maxPx); size >= Math.ceil(minPx); size -= 1) {
    if (measure(size) <= boxPx) return size;
  }
  return Math.ceil(minPx);
}
