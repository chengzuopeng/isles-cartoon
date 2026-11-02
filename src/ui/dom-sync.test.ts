import { describe, expect, it } from 'vitest'
import { syncStyle, syncText } from './dom-sync'

function fakeNode(): { node: HTMLElement; texts: string[]; styles: string[] } {
  const texts: string[] = []
  const styles: string[] = []
  let text = ''
  const node = {
    get textContent() {
      return text
    },
    set textContent(value: string) {
      text = value
      texts.push(value)
    },
    style: {
      setProperty(property: string, value: string) {
        styles.push(`${property}:${value}`)
      },
    },
  }
  return { node: node as unknown as HTMLElement, texts, styles }
}

describe('dom sync', () => {
  it('writes text only when it changes', () => {
    const { node, texts } = fakeNode()
    syncText(node, '12/12')
    syncText(node, '12/12')
    syncText(node, '11/12')
    syncText(node, '11/12')
    expect(texts).toEqual(['12/12', '11/12'])
  })

  it('writes each style property only when its value changes, element by element', () => {
    const a = fakeNode()
    const b = fakeNode()
    syncStyle(a.node, 'transform', 'scaleX(1.0000)')
    syncStyle(a.node, 'transform', 'scaleX(1.0000)')
    syncStyle(a.node, 'display', 'none')
    syncStyle(b.node, 'transform', 'scaleX(1.0000)')
    syncStyle(a.node, 'display', 'none')
    syncStyle(a.node, 'transform', 'scaleX(0.5000)')
    syncStyle(a.node, 'display', '')
    expect(a.styles).toEqual(['transform:scaleX(1.0000)', 'display:none', 'transform:scaleX(0.5000)', 'display:'])
    expect(b.styles).toEqual(['transform:scaleX(1.0000)'])
  })
})
