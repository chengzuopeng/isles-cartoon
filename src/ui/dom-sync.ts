const written = new WeakMap<HTMLElement, Map<string, string>>()

export function syncText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

export function syncStyle(node: HTMLElement, property: string, value: string): void {
  let styles = written.get(node)
  if (!styles) {
    styles = new Map()
    written.set(node, styles)
  }
  if (styles.get(property) === value) return
  styles.set(property, value)
  node.style.setProperty(property, value)
}
