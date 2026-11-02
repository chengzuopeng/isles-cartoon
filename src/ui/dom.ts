export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

export function button(parent: HTMLElement, kind: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', `screen-button ${kind}`, parent, label)
  node.type = 'button'
  node.tabIndex = -1
  node.addEventListener('mousedown', (event) => event.preventDefault())
  node.addEventListener('click', onClick)
  return node
}
