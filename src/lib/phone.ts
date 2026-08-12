/**
 * Country-aware phone parsing for lead capture.
 *
 * Most numbers we take are Indian 10-digit mobiles, but clients abroad have
 * numbers of a different length (UAE 9, Singapore 8, China 11 …), so a fixed
 * "exactly 10 digits" rule silently blocks real leads. Instead we detect the
 * country from the number itself and validate against that country's length.
 *
 * Detection works with or without a leading `+`: `+971501234567`,
 * `00971501234567` and `971501234567` all resolve to the UAE, while a bare
 * `9876543210` is treated as the default country (India).
 */

export interface PhoneCountry {
  /** Calling code, digits only, no `+`. */
  dial: string
  /** ISO 3166-1 alpha-2 — used to build the flag emoji. */
  iso: string
  name: string
  /** National significant number length (excluding the calling code). */
  min: number
  max: number
}

/** E.164 caps a full number (calling code + national part) at 15 digits. */
const E164_MAX = 15

/**
 * Lengths are the national significant number, i.e. what is left after the
 * calling code and after dropping any trunk prefix. Ranges are deliberately a
 * little generous — rejecting a real client's number is far worse than letting
 * an odd one through.
 */
const COUNTRIES: PhoneCountry[] = [
  { dial: '91',  iso: 'IN', name: 'India',          min: 10, max: 10 },
  { dial: '1',   iso: 'US', name: 'USA / Canada',   min: 10, max: 10 },
  { dial: '44',  iso: 'GB', name: 'United Kingdom', min: 9,  max: 10 },
  { dial: '971', iso: 'AE', name: 'UAE',            min: 8,  max: 9  },
  { dial: '966', iso: 'SA', name: 'Saudi Arabia',   min: 9,  max: 9  },
  { dial: '974', iso: 'QA', name: 'Qatar',          min: 8,  max: 8  },
  { dial: '968', iso: 'OM', name: 'Oman',           min: 8,  max: 8  },
  { dial: '965', iso: 'KW', name: 'Kuwait',         min: 8,  max: 8  },
  { dial: '973', iso: 'BH', name: 'Bahrain',        min: 8,  max: 8  },
  { dial: '972', iso: 'IL', name: 'Israel',         min: 8,  max: 9  },
  { dial: '962', iso: 'JO', name: 'Jordan',         min: 9,  max: 9  },
  { dial: '961', iso: 'LB', name: 'Lebanon',        min: 7,  max: 8  },
  { dial: '964', iso: 'IQ', name: 'Iraq',           min: 10, max: 10 },
  { dial: '98',  iso: 'IR', name: 'Iran',           min: 10, max: 10 },
  { dial: '92',  iso: 'PK', name: 'Pakistan',       min: 10, max: 10 },
  { dial: '880', iso: 'BD', name: 'Bangladesh',     min: 10, max: 10 },
  { dial: '94',  iso: 'LK', name: 'Sri Lanka',      min: 9,  max: 9  },
  { dial: '977', iso: 'NP', name: 'Nepal',          min: 10, max: 10 },
  { dial: '960', iso: 'MV', name: 'Maldives',       min: 7,  max: 7  },
  { dial: '65',  iso: 'SG', name: 'Singapore',      min: 8,  max: 8  },
  { dial: '60',  iso: 'MY', name: 'Malaysia',       min: 9,  max: 10 },
  { dial: '66',  iso: 'TH', name: 'Thailand',       min: 9,  max: 9  },
  { dial: '84',  iso: 'VN', name: 'Vietnam',        min: 9,  max: 10 },
  { dial: '62',  iso: 'ID', name: 'Indonesia',      min: 9,  max: 12 },
  { dial: '63',  iso: 'PH', name: 'Philippines',    min: 10, max: 10 },
  { dial: '86',  iso: 'CN', name: 'China',          min: 11, max: 11 },
  { dial: '852', iso: 'HK', name: 'Hong Kong',      min: 8,  max: 8  },
  { dial: '81',  iso: 'JP', name: 'Japan',          min: 10, max: 10 },
  { dial: '82',  iso: 'KR', name: 'South Korea',    min: 9,  max: 10 },
  { dial: '61',  iso: 'AU', name: 'Australia',      min: 9,  max: 9  },
  { dial: '64',  iso: 'NZ', name: 'New Zealand',    min: 8,  max: 10 },
  { dial: '49',  iso: 'DE', name: 'Germany',        min: 10, max: 11 },
  { dial: '33',  iso: 'FR', name: 'France',         min: 9,  max: 9  },
  { dial: '39',  iso: 'IT', name: 'Italy',          min: 9,  max: 10 },
  { dial: '34',  iso: 'ES', name: 'Spain',          min: 9,  max: 9  },
  { dial: '351', iso: 'PT', name: 'Portugal',       min: 9,  max: 9  },
  { dial: '31',  iso: 'NL', name: 'Netherlands',    min: 9,  max: 9  },
  { dial: '32',  iso: 'BE', name: 'Belgium',        min: 9,  max: 9  },
  { dial: '41',  iso: 'CH', name: 'Switzerland',    min: 9,  max: 9  },
  { dial: '43',  iso: 'AT', name: 'Austria',        min: 10, max: 12 },
  { dial: '46',  iso: 'SE', name: 'Sweden',         min: 7,  max: 9  },
  { dial: '47',  iso: 'NO', name: 'Norway',         min: 8,  max: 8  },
  { dial: '45',  iso: 'DK', name: 'Denmark',        min: 8,  max: 8  },
  { dial: '358', iso: 'FI', name: 'Finland',        min: 9,  max: 10 },
  { dial: '353', iso: 'IE', name: 'Ireland',        min: 9,  max: 9  },
  { dial: '48',  iso: 'PL', name: 'Poland',         min: 9,  max: 9  },
  { dial: '420', iso: 'CZ', name: 'Czechia',        min: 9,  max: 9  },
  { dial: '36',  iso: 'HU', name: 'Hungary',        min: 9,  max: 9  },
  { dial: '30',  iso: 'GR', name: 'Greece',         min: 10, max: 10 },
  { dial: '40',  iso: 'RO', name: 'Romania',        min: 9,  max: 9  },
  { dial: '380', iso: 'UA', name: 'Ukraine',        min: 9,  max: 9  },
  { dial: '7',   iso: 'RU', name: 'Russia / KZ',    min: 10, max: 10 },
  { dial: '90',  iso: 'TR', name: 'Turkey',         min: 10, max: 10 },
  { dial: '20',  iso: 'EG', name: 'Egypt',          min: 10, max: 10 },
  { dial: '212', iso: 'MA', name: 'Morocco',        min: 9,  max: 9  },
  { dial: '213', iso: 'DZ', name: 'Algeria',        min: 9,  max: 9  },
  { dial: '216', iso: 'TN', name: 'Tunisia',        min: 8,  max: 8  },
  { dial: '27',  iso: 'ZA', name: 'South Africa',   min: 9,  max: 9  },
  { dial: '234', iso: 'NG', name: 'Nigeria',        min: 10, max: 10 },
  { dial: '254', iso: 'KE', name: 'Kenya',          min: 9,  max: 9  },
  { dial: '255', iso: 'TZ', name: 'Tanzania',       min: 9,  max: 9  },
  { dial: '256', iso: 'UG', name: 'Uganda',         min: 9,  max: 9  },
  { dial: '233', iso: 'GH', name: 'Ghana',          min: 9,  max: 9  },
  { dial: '251', iso: 'ET', name: 'Ethiopia',       min: 9,  max: 9  },
  { dial: '55',  iso: 'BR', name: 'Brazil',         min: 10, max: 11 },
  { dial: '52',  iso: 'MX', name: 'Mexico',         min: 10, max: 10 },
  { dial: '54',  iso: 'AR', name: 'Argentina',      min: 10, max: 10 },
  { dial: '56',  iso: 'CL', name: 'Chile',          min: 9,  max: 9  },
  { dial: '57',  iso: 'CO', name: 'Colombia',       min: 10, max: 10 },
  { dial: '51',  iso: 'PE', name: 'Peru',           min: 9,  max: 9  },
]

/** Longest calling code first, so `+971` never matches as `+97`. */
const BY_DIAL_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

export const DEFAULT_COUNTRY = COUNTRIES[0] // India

/** Flag emoji from the ISO code — two regional indicator symbols. */
export function flagOf(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/[A-Z]/g, c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
}

export function lengthLabel(c: PhoneCountry): string {
  return c.min === c.max ? `${c.min} digits` : `${c.min}–${c.max} digits`
}

export interface ParsedPhone {
  /** Everything the user typed, digits only. This is what we store. */
  digits: string
  /** Detected country, or null when the code matches nothing we know. */
  country: PhoneCountry | null
  /** Digits after the calling code. Equals `digits` for a bare local number. */
  national: string
  valid: boolean
  /** Why it is invalid — shown as the field error. */
  error?: string
}

function fits(c: PhoneCountry, nationalLength: number): boolean {
  return nationalLength >= c.min && nationalLength <= c.max
}

/**
 * `hasCode` means the user made the calling code explicit (`+91…` / `0091…`),
 * so we trust the prefix even when the length is off — that is how we can say
 * "UAE numbers are 9 digits" instead of a generic error.
 */
function matchByPrefix(digits: string, hasCode: boolean): PhoneCountry | null {
  for (const c of BY_DIAL_LENGTH) {
    if (!digits.startsWith(c.dial)) continue
    if (hasCode || fits(c, digits.length - c.dial.length)) return c
  }
  return null
}

export function parsePhone(raw: string): ParsedPhone {
  const digits = (raw ?? '').replace(/\D/g, '')
  const hasCode = /^\s*(\+|00\d)/.test(raw ?? '')
  const body = hasCode && digits.startsWith('00') ? digits.slice(2) : digits

  if (!body) return { digits: '', country: null, national: '', valid: false, error: 'Phone is required' }

  // A bare number the length of a local one is local — don't let a number that
  // happens to start with "1" or "7" get read as a foreign calling code.
  if (!hasCode && fits(DEFAULT_COUNTRY, body.length)) {
    return { digits: body, country: DEFAULT_COUNTRY, national: body, valid: true }
  }

  const country = matchByPrefix(body, hasCode)
  if (country) {
    const national = body.slice(country.dial.length)
    const valid = fits(country, national.length)
    return {
      digits: body,
      country,
      national,
      valid,
      error: valid ? undefined : `${country.name} numbers are ${lengthLabel(country)} after +${country.dial}`,
    }
  }

  // No `+` and no code we recognise: it can only have been meant as a local
  // number, so hold it to the default country's length instead of waving a
  // mistyped one through as "some other country".
  if (!hasCode) {
    return {
      digits: body,
      country: DEFAULT_COUNTRY,
      national: body,
      valid: false,
      error: `${DEFAULT_COUNTRY.name} numbers are ${lengthLabel(DEFAULT_COUNTRY)} — add the + country code for other countries`,
    }
  }

  // Unknown calling code: fall back to the E.164 envelope rather than blocking.
  const valid = body.length >= 8 && body.length <= E164_MAX
  return {
    digits: body,
    country: null,
    national: body,
    valid,
    error: valid ? undefined : `Enter a valid phone number (8–${E164_MAX} digits, or add the + country code)`,
  }
}

/** Trim typing input to what could still become a valid number. */
export function sanitizePhoneInput(raw: string): string {
  const plus = /^\s*\+/.test(raw) ? '+' : ''
  return plus + raw.replace(/\D/g, '').slice(0, E164_MAX)
}

/**
 * Values to check for a duplicate lead. Numbers saved before country detection
 * are bare national digits, so an international entry has to be matched both
 * ways or the same client can be added twice.
 */
export function duplicateCandidates(raw: string): string[] {
  const { digits, national } = parsePhone(raw)
  return [...new Set([digits, national].filter(Boolean))]
}
