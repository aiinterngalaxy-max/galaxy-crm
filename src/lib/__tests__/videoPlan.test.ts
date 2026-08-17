import { describe, it, expect } from 'vitest'
import { styleProfileToCommands, type ReferenceStyleProfile } from '../content-studio/videoPlan'
import type { InterpretContext } from '../content-studio/aiEditCommands'

const neutralProfile: ReferenceStyleProfile = {
  aspect: '9:16', brightness: 0, contrast: 1, saturation: 1, warmth: 0,
  captionColor: 'white', captionBold: false, captionPosition: 'bottom', vibe: 'plain',
}

const ctx = (over: Partial<InterpretContext> = {}): InterpretContext => ({ durationSec: 20, hasMusic: false, ...over })

describe('styleProfileToCommands', () => {
  it('always includes a crop matching the reference aspect', () => {
    const commands = styleProfileToCommands(neutralProfile, ctx())
    expect(commands).toContainEqual({ type: 'crop', aspect: '9:16' })
  })

  it('omits the color command entirely when every value is neutral — never a no-op edit', () => {
    const commands = styleProfileToCommands(neutralProfile, ctx())
    expect(commands.some((c) => c.type === 'color')).toBe(false)
  })

  it('includes only the color fields that actually differ from neutral', () => {
    const profile: ReferenceStyleProfile = { ...neutralProfile, brightness: 0.3, contrast: 1, saturation: 1.5, warmth: 0 }
    const commands = styleProfileToCommands(profile, ctx())
    const color = commands.find((c) => c.type === 'color')
    expect(color).toMatchObject({ brightness: 0.3, saturation: 1.5 })
    expect(color).not.toHaveProperty('contrast')
    expect(color).not.toHaveProperty('warmth')
  })

  it('never invents text/caption content — only restyles layers that already exist', () => {
    const commands = styleProfileToCommands(neutralProfile, ctx())
    expect(commands.some((c) => c.type === 'text' || c.type === 'caption')).toBe(false)
  })

  it('restyles every existing text layer individually, each targeted by its own exact text', () => {
    const withLayers = ctx({
      textLayers: [
        { id: 'ov-1', text: 'Galaxy Home Automation', start: 0, end: 3 },
        { id: 'ov-2', text: 'Smart Living', start: 3, end: 6 },
      ],
    })
    const profile: ReferenceStyleProfile = { ...neutralProfile, captionColor: 'red', captionBold: true, captionPosition: 'top' }
    const commands = styleProfileToCommands(profile, withLayers)
    const styles = commands.filter((c) => c.type === 'text_style')
    expect(styles).toHaveLength(2)
    expect(styles).toContainEqual({ type: 'text_style', overlayId: 'ov-1', text: 'Galaxy Home Automation', color: 'red', bold: true, position: 'top' })
    expect(styles).toContainEqual({ type: 'text_style', overlayId: 'ov-2', text: 'Smart Living', color: 'red', bold: true, position: 'top' })
  })

  it('produces zero text_style commands when there are no existing text layers', () => {
    const commands = styleProfileToCommands(neutralProfile, ctx())
    expect(commands.some((c) => c.type === 'text_style')).toBe(false)
  })

  it('every produced command is already validated — never an error object slipping through', () => {
    const profile: ReferenceStyleProfile = { ...neutralProfile, brightness: 0.5, aspect: '1:1' }
    const commands = styleProfileToCommands(profile, ctx())
    for (const c of commands) expect(c).not.toHaveProperty('error')
  })
})
