import { describe, it, expect } from 'vitest'
import { describeFirestoreError, stripUndefined } from '../errorMessage'

function fbError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { code })
}

describe('stripUndefined', () => {
  // Firestore throws on undefined anywhere in a document, which is what made
  // "Failed to create lead" fire with no usable explanation.
  it('drops undefined keys', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })

  it('keeps null, false, empty string and zero', () => {
    expect(stripUndefined({ a: null, b: false, c: '', d: 0 })).toEqual({ a: null, b: false, c: '', d: 0 })
  })

  it('leaves a clean object untouched', () => {
    expect(stripUndefined({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('describeFirestoreError', () => {
  it('explains a permission failure in terms an operator can act on', () => {
    expect(describeFirestoreError(fbError('permission-denied'), 'Failed')).toMatch(/permission/i)
  })

  it('tells the user to sign in again when unauthenticated', () => {
    expect(describeFirestoreError(fbError('unauthenticated'), 'Failed')).toMatch(/sign in again/i)
  })

  it('blames the connection when the backend is unreachable', () => {
    expect(describeFirestoreError(fbError('unavailable'), 'Failed')).toMatch(/internet connection/i)
  })

  // The exact failure that broke lead creation: an undefined field.
  it('names the offending field for an undefined value', () => {
    const err = new Error(
      'Function addDoc() called with invalid data. Unsupported field value: undefined (found in field createdBy in document leads/x)',
    )
    const msg = describeFirestoreError(err, 'Failed to create lead')
    expect(msg).toContain('createdBy')
    expect(msg).toMatch(/Refresh the page/i)
  })

  it('still explains an undefined value when no field name is given', () => {
    const err = new Error('Unsupported field value: undefined')
    expect(describeFirestoreError(err, 'Failed')).toMatch(/required field was empty/i)
  })

  it('keeps the original message for an unrecognised error', () => {
    expect(describeFirestoreError(new Error('something odd'), 'Failed')).toBe('Failed: something odd')
  })

  it('falls back cleanly for a non-Error value', () => {
    expect(describeFirestoreError('just a string', 'Failed')).toBe('Failed')
  })
})
