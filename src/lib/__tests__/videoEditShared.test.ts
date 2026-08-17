import { describe, it, expect } from 'vitest'
import { toSrt, toVtt, type SubtitleCue } from '../content-studio/videoEditShared'

const cues: SubtitleCue[] = [
  { text: 'Hello there', start: 0, end: 2 },
  { text: 'Welcome to Galaxy Home Automation', start: 2.5, end: 5 },
]

describe('toSrt', () => {
  it('produces sequential numbered blocks with HH:MM:SS,mmm timestamps', () => {
    const srt = toSrt(cues)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\nHello there')
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,000\nWelcome to Galaxy Home Automation')
  })

  it('skips cues with empty/whitespace-only text', () => {
    const srt = toSrt([...cues, { text: '   ', start: 6, end: 7 }])
    expect(srt).not.toMatch(/-->.*\n\s*\n\s*$/)
    expect(srt.match(/-->/g)?.length).toBe(2)
  })

  it('gives a zero-length cue (start === end) a minimum 1s window rather than an invalid zero-duration block', () => {
    const srt = toSrt([{ text: 'Whole video', start: 0, end: 0 }])
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000')
  })
})

describe('toVtt', () => {
  it('starts with the WEBVTT header and uses dot-separated milliseconds', () => {
    const vtt = toVtt(cues)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.000\nHello there')
  })

  it('never includes an SRT-style comma timestamp', () => {
    const vtt = toVtt(cues)
    expect(vtt).not.toMatch(/\d{2}:\d{2}:\d{2},\d{3}/)
  })
})
