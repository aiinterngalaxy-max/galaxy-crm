import { describe, it, expect } from 'vitest'
import { getZoneSuggestions, ZONE_RULES } from '../zoneRules'

describe('getZoneSuggestions', () => {
  it('returns empty array for unrecognised zone name', () => {
    expect(getZoneSuggestions('storage room')).toHaveLength(0)
    expect(getZoneSuggestions('')).toHaveLength(0)
  })

  it('returns exactly one matching rule', () => {
    expect(getZoneSuggestions('living room')).toHaveLength(1)
  })

  it('matches washroom keywords', () => {
    expect(getZoneSuggestions('washroom')[0].label).toBe('Washroom')
    expect(getZoneSuggestions('toilet')[0].label).toBe('Washroom')
    expect(getZoneSuggestions('bathroom')[0].label).toBe('Washroom')
  })

  it('matches living room keywords', () => {
    expect(getZoneSuggestions('living room')[0].label).toBe('Living Room')
    expect(getZoneSuggestions('lounge')[0].label).toBe('Living Room')
    expect(getZoneSuggestions('hall')[0].label).toBe('Living Room')
  })

  it('matches master bedroom before generic bedroom', () => {
    expect(getZoneSuggestions('master bedroom')[0].label).toBe('Master Bedroom')
  })

  it('matches generic bedroom', () => {
    expect(getZoneSuggestions('bedroom')[0].label).toBe('Bedroom')
    expect(getZoneSuggestions('bed room')[0].label).toBe('Bedroom')
  })

  it('matches kitchen', () => {
    expect(getZoneSuggestions('kitchen')[0].label).toBe('Kitchen')
  })

  it('matches passage / entry keywords', () => {
    expect(getZoneSuggestions('passage')[0].label).toBe('Passage / Entry')
    expect(getZoneSuggestions('corridor')[0].label).toBe('Passage / Entry')
    expect(getZoneSuggestions('foyer')[0].label).toBe('Passage / Entry')
    expect(getZoneSuggestions('entrance')[0].label).toBe('Passage / Entry')
  })

  it('matches balcony keywords', () => {
    expect(getZoneSuggestions('balcony')[0].label).toBe('Balcony')
    expect(getZoneSuggestions('terrace')[0].label).toBe('Balcony')
  })

  it('matches dining', () => {
    expect(getZoneSuggestions('dining')[0].label).toBe('Dining')
    expect(getZoneSuggestions('dining area')[0].label).toBe('Dining')
  })

  it('matches study / office keywords', () => {
    expect(getZoneSuggestions('study')[0].label).toBe('Study / Office')
    expect(getZoneSuggestions('office')[0].label).toBe('Study / Office')
    expect(getZoneSuggestions('work room')[0].label).toBe('Study / Office')
  })

  it('is case-insensitive', () => {
    expect(getZoneSuggestions('LIVING ROOM')[0].label).toBe('Living Room')
    expect(getZoneSuggestions('Kitchen')[0].label).toBe('Kitchen')
  })

  it('matches partial names (substring match)', () => {
    expect(getZoneSuggestions('master bedroom 1')[0].label).toBe('Master Bedroom')
    expect(getZoneSuggestions('kids bedroom')[0].label).toBe('Bedroom')
  })

  it('each matched rule has at least one suggestion', () => {
    ZONE_RULES.forEach(rule => {
      rule.keywords.forEach(kw => {
        const result = getZoneSuggestions(kw)
        expect(result[0].suggestions.length).toBeGreaterThan(0)
      })
    })
  })

  it('each matched rule has a non-empty reason', () => {
    ZONE_RULES.forEach(rule => {
      const result = getZoneSuggestions(rule.keywords[0])
      expect(result[0].reason.length).toBeGreaterThan(0)
    })
  })
})
