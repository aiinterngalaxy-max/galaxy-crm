import type { JobDescription } from '../../types'

const EMP_LABELS: Record<string, string> = {
  full_time: 'Full-Time', part_time: 'Part-Time', internship: 'Internship', contract: 'Contract / Freelance',
}

function extractSections(rawJD: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {}
  let current = ''
  for (const line of rawJD.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('##') || trimmed.startsWith('#')) {
      current = trimmed.replace(/^#+\s*/, '').toLowerCase()
      sections[current] = []
    } else if (current && (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*'))) {
      sections[current] = sections[current] || []
      sections[current].push(trimmed.replace(/^[-•*]\s*/, ''))
    } else if (current && trimmed && !trimmed.startsWith('#')) {
      sections[current] = sections[current] || []
      sections[current].push(trimmed)
    }
  }
  return sections
}

function findSection(sections: Record<string, string[]>, ...keys: string[]): string[] {
  for (const key of keys) {
    const match = Object.keys(sections).find(k => k.includes(key))
    if (match && sections[match].length) return sections[match]
  }
  return []
}

function bulletList(items: string[]): string {
  if (!items.length) return ''
  return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
}

function metaRow(label: string, value: string): string {
  return value ? `<p class="meta-row"><strong>${label}:</strong> ${value}</p>` : ''
}

async function getLogoBase64(): Promise<string> {
  try {
    const res = await fetch('/galaxy-logo.png')
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

export async function downloadJDasPDF(jd: JobDescription): Promise<void> {
  const logoBase64 = await getLogoBase64()

  const empTypes = jd.employmentType
    .split(',')
    .map(t => EMP_LABELS[t.trim()] || t.trim())
    .join(' / ')

  const comp = jd.compensation
  const salaryText = (() => {
    if (!comp) return ''
    const label = comp.type === 'stipend' ? 'Stipend' : 'Salary'
    if (comp.min && comp.max)
      return `₹${comp.min.toLocaleString('en-IN')} – ₹${comp.max.toLocaleString('en-IN')} ${comp.type === 'salary' ? 'LPA' : 'per month'}`
    if (comp.min) return `₹${comp.min.toLocaleString('en-IN')}+ ${comp.type === 'salary' ? 'LPA' : 'per month'}`
    if (comp.max) return `Up to ₹${comp.max.toLocaleString('en-IN')} ${comp.type === 'salary' ? 'LPA' : 'per month'}`
    return ''
  })()

  const sections = extractSections(jd.rawJD || '')

  const responsibilities = findSection(sections, 'responsibilit')
  const requirements     = findSection(sections, 'requirement', 'prerequisite')
  const benefits         = findSection(sections, 'benefit', 'compensation', 'perks')
  const whatWeLook       = findSection(sections, 'looking for', 'culture', 'personality')

  const logoHtml = logoBase64
    ? `<img src="${logoBase64}" alt="Galaxy Home Automation" class="logo-img" />`
    : `<span class="logo-text">GALAXY</span>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${jd.title} — Galaxy Home Automation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 13px; color: #222; background: #fff; }
    .page { max-width: 800px; margin: 0 auto; padding: 0 0 48px; }

    /* Header banner */
    .header-banner {
      display: flex;
      align-items: stretch;
      border: 2px solid #888;
      margin-bottom: 0;
    }
    .header-logo {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-right: 2px solid #888;
      min-width: 220px;
    }
    .logo-img { max-height: 100px; max-width: 200px; object-fit: contain; }
    .logo-text { font-size: 32px; font-weight: 900; color: #C9A840; letter-spacing: 2px; }
    .header-info {
      padding: 10px 18px;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .header-company {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      color: #111;
    }
    .header-address {
      font-size: 11.5px;
      line-height: 1.6;
      color: #222;
    }
    .header-contact {
      display: flex;
      gap: 24px;
      margin-top: 6px;
      font-size: 11.5px;
      color: #222;
    }

    /* Title */
    .doc-title {
      text-align: center;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 1px;
      padding: 14px 0 10px;
      border-bottom: 1px solid #ccc;
      margin-bottom: 18px;
    }

    /* Meta rows */
    .meta-section { padding: 0 40px; margin-bottom: 16px; }
    .meta-row { margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
    .meta-row strong { font-weight: 700; }

    /* Sections */
    .section { padding: 0 40px; margin-bottom: 14px; }
    .section-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #5b9bd5;
      margin-bottom: 8px;
    }
    ul { padding-left: 28px; margin: 0; }
    li { margin-bottom: 5px; font-size: 13px; line-height: 1.55; }
    p { font-size: 13px; line-height: 1.6; margin-bottom: 4px; }

    /* Footer contact */
    .footer-contact { padding: 14px 40px 0; font-size: 13px; line-height: 1.7; }

    /* Print button */
    .print-btn {
      position: fixed; top: 16px; right: 16px;
      background: #5b9bd5; color: #fff; border: none;
      padding: 9px 18px; border-radius: 6px;
      font-weight: 700; font-size: 13px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-family: Arial, sans-serif;
    }
    .print-btn:hover { background: #4a87c0; }

    @media print {
      .print-btn { display: none; }
      body { font-size: 12px; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">⬇ Save as PDF</button>
  <div class="page">

    <!-- Header banner matching Galaxy template -->
    <div class="header-banner">
      <div class="header-logo">${logoHtml}</div>
      <div class="header-info">
        <div class="header-company">GALAXY HOME AUTOMATION LLP.</div>
        <div class="header-address">
          Shop No. 1, Gr. Floor, P. P. DIAS COMPOUND, OFF W.E.<br/>
          Highway, Jogeshwari - East, Mumbai – 400060, Maharashtra.
        </div>
        <div class="header-contact">
          <span>M. 9820008979, 7718882898</span>
          <span>Email: galaxy.homeauto@gmail.com</span>
          <span>www.galaxyhomeautomation.com</span>
        </div>
      </div>
    </div>

    <!-- Document title -->
    <div class="doc-title">${jd.title.toUpperCase()} - JOB DESCRIPTION</div>

    <!-- Meta fields -->
    <div class="meta-section">
      ${metaRow('Company', 'Galaxy Home Automation')}
      ${metaRow('Position', jd.title)}
      ${metaRow('Department', jd.department)}
      ${metaRow('Employment Type', empTypes)}
      ${salaryText ? metaRow(comp?.type === 'stipend' ? 'Stipend' : 'Salary', salaryText) : ''}
      ${metaRow('Location', 'Goregaon, Mumbai')}
    </div>

    ${responsibilities.length ? `
    <div class="section">
      <div class="section-title">Roles &amp; Responsibilities</div>
      ${bulletList(responsibilities)}
    </div>` : ''}

    ${requirements.length ? `
    <div class="section">
      <div class="section-title">Requirements</div>
      ${bulletList(requirements)}
    </div>` : ''}

    ${whatWeLook.length ? `
    <div class="section">
      <div class="section-title">What We're Looking For</div>
      ${bulletList(whatWeLook)}
    </div>` : ''}

    <div class="section">
      <div class="section-title">Working Hours</div>
      <p>10:00 AM to 7:00 PM</p>
      <p>Monday to Saturday</p>
    </div>

    ${benefits.length ? `
    <div class="section">
      <div class="section-title">Benefits</div>
      ${bulletList(benefits)}
    </div>` : ''}

    <!-- Footer -->
    <div class="footer-contact">
      <p>For Apply Contact:</p>
      <p>Galaxy Home Automation</p>
      <p>Mumbai, Maharashtra</p>
    </div>

  </div>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) win.focus()
  setTimeout(() => URL.revokeObjectURL(url), 15000)
}
