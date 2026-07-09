export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const key = process.env.VITE_MAPPLS_KEY

  if (!from || !to) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })

  try {
    const geocode = async (q: string) => {
      const r = await fetch(`https://apis.mappls.com/advancedmaps/v1/${key}/geocode?address=${encodeURIComponent(q)}&region=IND`)
      const d = await r.json()
      const res = d.copResults?.[0]
      if (!res) throw new Error('Location not found: ' + q)
      return { lat: res.latitude, lon: res.longitude }
    }

    const [f, t] = await Promise.all([geocode(from), geocode(to)])
    const r = await fetch(`https://apis.mappls.com/advancedmaps/v1/${key}/distance_matrix/driving/${f.lon},${f.lat};${t.lon},${t.lat}?rtype=1&region=IND`)
    const d = await r.json()
    const meters = d.results?.distances?.[0]?.[1]
    if (!meters) throw new Error('Route not found')
    const km = Math.round(meters / 1000)

    return new Response(JSON.stringify({ km }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
