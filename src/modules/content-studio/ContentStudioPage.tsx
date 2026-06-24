import { useState, useEffect } from 'react'
import { Sparkles, Copy, Check, History, Wand2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../contexts/AuthContext'
import {
  db, collection, query, orderBy, getDocs, addDoc, serverTimestamp
} from '../../lib/firebase'
import { formatRelative } from '../../lib/utils'
import type { ContentItem, ContentType, ContentPlatform } from '../../types'
import toast from 'react-hot-toast'

const CONTENT_TYPES: { value: ContentType; label: string; placeholder: string }[] = [
  { value: 'reel_script', label: 'Reel Script', placeholder: 'e.g., Show how voice control works in a luxury living room' },
  { value: 'caption', label: 'Instagram Caption', placeholder: 'e.g., Smart lighting transformation in a 3BHK apartment' },
  { value: 'linkedin_post', label: 'LinkedIn Post', placeholder: 'e.g., How home automation is changing luxury real estate in Mumbai' },
  { value: 'product_description', label: 'Product Description', placeholder: 'e.g., Smart dimmer switch with Alexa control, 2-gang, modern finish' },
  { value: 'ad_copy', label: 'Ad Copy', placeholder: 'e.g., Facebook ad targeting homeowners in Andheri, ₹50K+ income, new flat buyers' },
]

const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'general', label: 'General' },
]

// Simulated AI content templates (until API key is added)
const CONTENT_TEMPLATES: Record<ContentType, (prompt: string) => string> = {
  reel_script: (prompt) => `🎬 REEL SCRIPT — Galaxy Home Automation

[HOOK — 0-3 sec]
"This is what your home could sound like..."
[Show: dark room, voice command moment]

[PROBLEM — 3-8 sec]
Tired of getting up to control lights, AC, or curtains?
[Show: person fumbling with remotes]

[SOLUTION — 8-20 sec]
Galaxy Home Automation transforms your home with one touch — or just your voice.
Control lighting, climate, security, and entertainment from your phone or smart display.
[Show: seamless product demo — ${prompt}]

[SOCIAL PROOF — 20-30 sec]
500+ smart homes across Mumbai.
"It changed how we live." — Real Galaxy customer

[CTA — 30-35 sec]
Book a free home assessment today. Link in bio. ⚡
#GalaxyHomeAutomation #SmartHome #HomeAutomation #Mumbai`,

  caption: (prompt) => `✨ Transformation Tuesday: ${prompt}

Every room tells a story. This one says: "I have complete control."

With Galaxy Home Automation, our team turned this space into a fully intelligent home — lights that adapt to your mood, curtains that open with sunrise, and climate that adjusts automatically.

The future of comfortable living is here. And it's made right in Mumbai. 🏠⚡

📞 DM us for a free consultation
🔗 Link in bio to see more projects

#GalaxyHomeAutomation #SmartHome #HomeAutomation #Mumbai #LuxuryLiving #SmartLiving #ModernHome #HomeDesign #InteriorDesign #TechLife`,

  linkedin_post: (prompt) => `💡 ${prompt}

At Galaxy Home Automation, we've been transforming homes across Mumbai for years. And the pattern we see is clear:

People don't just buy smart home systems. They buy time, comfort, and control.

Here's what our clients tell us after installation:
→ "I save 45 minutes a day on routine tasks"
→ "My electricity bill dropped 20% in the first month"
→ "I can monitor my home when I'm traveling — I sleep better"

Home automation isn't a luxury anymore. It's infrastructure.

If you're a developer, architect, or homeowner thinking about this — I'd love to connect and share what we've learned installing 500+ smart homes.

What questions do you have about smart home technology? Drop them in the comments 👇

#HomeAutomation #SmartHome #PropTech #RealEstate #Mumbai #Technology #Innovation`,

  product_description: (prompt) => `**Galaxy Smart ${prompt}**

Transform the way you control your home with the Galaxy Smart Dimmer — precision engineering meets elegant design.

**Key Features:**
• Voice control: Compatible with Alexa, Google Home, and Siri
• App control: Adjust from anywhere via the Galaxy app
• Smart scheduling: Set scenes for morning, evening, movie time, and sleep
• Energy monitoring: Track consumption in real-time
• Universal compatibility: Works with LED, CFL, and incandescent bulbs

**Why Galaxy?**
Unlike generic smart switches, ours are engineered for Indian homes — tested for voltage fluctuations, humidity, and the way Indian families actually use their spaces.

**Installation:** Professional installation by our certified technicians. 2-year warranty. Lifetime support.

📞 Get a free quote: Contact us today`,

  ad_copy: (prompt) => `**AD COPY VARIANTS — ${prompt}**

---
**VARIANT A (Aspirational)**
Headline: "Your Home. Your Control. Your Galaxy."
Body: 500+ families in Mumbai trust Galaxy Home Automation to make their homes intelligent. Lights, climate, security — all from one app. Book your free home assessment today.
CTA: Get Free Assessment

---
**VARIANT B (Problem-Solution)**
Headline: "Still Getting Up to Turn Off Lights?"
Body: Galaxy Home Automation gives you voice and app control over every switch in your home. No more walking around. No more forgotten lights. Starting at ₹1.5L for a complete solution.
CTA: See Packages

---
**VARIANT C (Social Proof)**
Headline: "500 Smart Homes. 1 Team You Can Trust."
Body: Galaxy Home Automation has transformed 500+ homes across Mumbai. Check our Instagram to see the before/after. Then book your free consultation — we'll design your smart home from scratch.
CTA: Book Free Consultation`
}

export function ContentStudioPage() {
  const { user } = useAuth()
  const [contentType, setContentType] = useState<ContentType>('reel_script')
  const [platform, setPlatform] = useState<ContentPlatform>('instagram')
  const [prompt, setPrompt] = useState('')
  const [generated, setGenerated] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<ContentItem[]>([])
  const [saving, setSaving] = useState(false)

  const currentType = CONTENT_TYPES.find(t => t.value === contentType)

  useEffect(() => {
    getDocs(query(collection(db, 'contentStudio'), orderBy('createdAt', 'desc')))
      .then(snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContentItem)))
      .catch(console.error)
  }, [])

  const generate = async () => {
    if (!prompt.trim()) { toast.error('Enter a prompt first'); return }
    setGenerating(true)
    setGenerated('')
    try {
      // Simulate AI generation (replace with actual Claude API call when key is available)
      await new Promise(r => setTimeout(r, 1500))
      const content = CONTENT_TEMPLATES[contentType](prompt)
      setGenerated(content)
    } catch {
      toast.error('Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const copyContent = () => {
    navigator.clipboard.writeText(generated)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Copied to clipboard')
  }

  const saveContent = async () => {
    if (!generated) return
    setSaving(true)
    try {
      const ref = await addDoc(collection(db, 'contentStudio'), {
        createdBy: user?.id,
        createdByName: user?.name,
        type: contentType,
        prompt,
        generatedContent: generated,
        platform,
        status: 'draft',
        createdAt: serverTimestamp(),
      })
      const newItem: ContentItem = {
        id: ref.id,
        createdBy: user?.id || '',
        createdByName: user?.name,
        type: contentType,
        prompt,
        generatedContent: generated,
        platform,
        status: 'draft',
        createdAt: { toDate: () => new Date() } as ContentItem['createdAt'],
      }
      setHistory(prev => [newItem, ...prev])
      toast.success('Saved to content library')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-pink-400" />
          Content Studio
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">AI-powered marketing content for Galaxy Home Automation</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Generator */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-gray-200 mb-4">Generate Content</h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <Select
                label="Content Type"
                options={CONTENT_TYPES.map(t => ({ value: t.value, label: t.label }))}
                value={contentType}
                onChange={e => setContentType(e.target.value as ContentType)}
              />
              <Select
                label="Platform"
                options={PLATFORM_OPTIONS}
                value={platform}
                onChange={e => setPlatform(e.target.value as ContentPlatform)}
              />
            </div>

            <Textarea
              label="Describe what you want"
              placeholder={currentType?.placeholder}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
            />

            <div className="mt-3 flex items-center gap-3">
              <Button
                onClick={generate}
                loading={generating}
                icon={<Wand2 className="w-4 h-4" />}
              >
                {generating ? 'Generating…' : 'Generate'}
              </Button>
              <p className="text-xs text-gray-600">
                AI key not configured — using templates. Add <code className="text-indigo-400">VITE_ANTHROPIC_API_KEY</code> to enable Claude.
              </p>
            </div>
          </Card>

          {/* Output */}
          {generated && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-200">Generated Content</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={copyContent}
                    icon={copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <Button size="sm" onClick={saveContent} loading={saving}>Save</Button>
                </div>
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-800/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                {generated}
              </pre>
            </Card>
          )}
        </div>

        {/* History */}
        <div>
          <Card padding="none">
            <div className="p-4 border-b border-gray-800 flex items-center gap-2">
              <History className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-200">Content Library</h3>
            </div>
            {history.length === 0 && (
              <p className="p-5 text-xs text-gray-600 text-center">No saved content yet</p>
            )}
            <div className="divide-y divide-gray-800 max-h-[600px] overflow-y-auto">
              {history.map(item => (
                <div
                  key={item.id}
                  onClick={() => setGenerated(item.editedContent || item.generatedContent)}
                  className="px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge color="text-pink-400" bg="bg-pink-900/30">
                      {CONTENT_TYPES.find(t => t.value === item.type)?.label}
                    </Badge>
                    <Badge color="text-gray-400" bg="bg-gray-800">
                      {item.platform}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{item.prompt}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{formatRelative(item.createdAt)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
