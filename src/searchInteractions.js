export function nextSearchIndex(current, count, direction) {
  if (!count) return -1
  return (current + direction + count) % count
}

export function searchKeyboardAction({ key, open, activeIndex, resultCount }) {
  if (key === 'Escape') return { type: 'close' }
  if (key === 'ArrowDown') return { type: 'highlight', activeIndex: nextSearchIndex(activeIndex, resultCount, 1), open: true }
  if (key === 'ArrowUp') return { type: 'highlight', activeIndex: nextSearchIndex(activeIndex, resultCount, -1), open: true }
  if (key === 'Enter' && open && activeIndex >= 0 && activeIndex < resultCount) return { type: 'select', activeIndex }
  return { type: 'none' }
}

export function clearedSearchState() {
  return { query: '', results: [], status: 'idle', message: '', open: false, activeIndex: -1 }
}
