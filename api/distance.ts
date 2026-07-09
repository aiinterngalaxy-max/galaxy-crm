export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const key = process.env.VITE_MAPPLS_KEY

  if (!from || !to) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  try {
    const geocode = async (q: string) => {
      const url = `https://apis.mappls.com/advancedmaps/v1/${key}/geocode?address=${encodeURIComponent(q)}&region=IND`
      const r = await fetch(url)
      const text = await r.text()
      let d: any
      try { d = JSON.parse(text) } catch { throw new Error(`Geocode parse fail for "${q}": ${text.slice(0, 200)}`) }
      const res = d.copResults?.[0]
      if (!res) throw new Error(`Location not found: "${q}". API said: ${text.slice(0, 200)}`)
      return { lat: String(res.latitude), lon: String(res.longitude) }
    }

    const [f, t] = await Promise.all([geocode(from), geocode(to)])
    const dmUrl = `https://apis.mappls.com/advancedmaps/v1/${key}/distance_matrix/driving/${f.lon},${f.lat};${t.lon},${t.lat}?rtype=1&region=IND`
    const r = await fetch(dmUrl)
    const text = await r.text()
    let d: any
    try { d = JSON.parse(text) } catch { throw new Error(`Distance parse fail: ${text.slice(0, 200)}`) }
    const meters = d.results?.distances?.[0]?.[1]
    if (!meters) throw new Error(`Route not found. API said: ${text.slice(0, 300)}`)
    const km = Math.round(meters / 1000)

    return new Response(JSON.stringify({ km }), { headers })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers })
  }
}
