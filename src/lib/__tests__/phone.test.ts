import { describe, it, expect } from 'vitest'
import { parsePhone, sanitizePhoneInput, duplicateCandidates, flagOf } from '../phone'

describe('parsePhone', () => {
  it('treats a bare 10-digit number as India', () => {
    const p = parsePhone('9876543210')
    expect(p.country?.iso).toBe('IN')
    expect(p.national).toBe('9876543210')
    expect(p.digits).toBe('9876543210')
    expect(p.valid).toBe(true)
  })

  it('strips spaces, dashes and brackets', () => {
    expect(parsePhone('+91 (98765) 43-210').digits).toBe('919876543210')
  })

  it('detects the country from an explicit + code', () => {
    const p = parsePhone('+971501234567')
    expect(p.country?.iso).toBe('AE')
    expect(p.national).toBe('501234567')
    expect(p.valid).toBe(true)
  })

  it('detects the country without a + when the length fits', () => {
    expect(parsePhone('971501234567').country?.iso).toBe('AE')
    expect(parsePhone('8613912345678').country?.iso).toBe('CN')
  })

  it('accepts the 00 international prefix', () => {
    const p = parsePhone('0044 7911 123456')
    expect(p.country?.iso).toBe('GB')
    expect(p.valid).toBe(true)
  })

  it('prefers the longest matching calling code', () => {
    expect(parsePhone('+9779812345678').country?.iso).toBe('NP')
  })

  it('rejects a number of the wrong length for its country', () => {
    const p = parsePhone('+9715012345')
    expect(p.country?.iso).toBe('AE')
    expect(p.valid).toBe(false)
    expect(p.error).toContain('UAE')
  })

  it('rejects a bare Indian number that is not 10 digits', () => {
    expect(parsePhone('98765432').valid).toBe(false)
  })

  it('falls back to the E.164 envelope for an unknown code', () => {
    const p = parsePhone('+9991234567')
    expect(p.country).toBeNull()
    expect(p.valid).toBe(true)
  })

  it('rejects an empty value', () => {
    expect(parsePhone('').valid).toBe(false)
  })
})

describe('sanitizePhoneInput', () => {
  it('keeps a leading + and drops other punctuation', () => {
    expect(sanitizePhoneInput('+971 50-123 4567')).toBe('+971501234567')
    expect(sanitizePhoneInput('98765abc43210')).toBe('9876543210')
  })

  it('caps the digits at the E.164 maximum', () => {
    expect(sanitizePhoneInput('+1234567890123456789')).toBe('+123456789012345')
  })
})

describe('duplicateCandidates', () => {
  it('checks both the full and the national form of an international number', () => {
    expect(duplicateCandidates('+971501234567')).toEqual(['971501234567', '501234567'])
  })

  it('checks a local number once', () => {
    expect(duplicateCandidates('9876543210')).toEqual(['9876543210'])
  })
})

describe('flagOf', () => {
  it('builds the flag emoji from the ISO code', () => {
    expect(flagOf('IN')).toBe('🇮🇳')
  })
})
