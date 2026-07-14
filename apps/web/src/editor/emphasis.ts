export function exactOccurrenceCount(text: string, excerpt: string): number {
  if (!excerpt) return 0
  let occurrences = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith(excerpt, index)) occurrences += 1
  }
  return occurrences
}
