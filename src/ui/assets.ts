export function icon(parent: HTMLElement, className: string, url: string): HTMLImageElement {
  const node = document.createElement('img')
  node.className = className
  if (url) node.src = url
  node.alt = ''
  node.draggable = false
  node.decoding = 'async'
  parent.appendChild(node)
  return node
}

export function preload(urls: readonly string[]): void {
  for (const url of urls) {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
  }
}
