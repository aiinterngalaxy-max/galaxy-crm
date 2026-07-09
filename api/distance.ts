export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const key = process.env.VITE_MAPPLS_KEY

  if (!from || !to) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  try {
    // Nominatim (OpenStreetMap) for geocoding — free, reliable, no API key
    const geocode = async (q: string) => {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', India')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'TopzCab/1.0' } }
      )
      const d = await r.json()
      if (!d[0]) throw new Error(`Location not found: "${q}"`)
      return { lat: d[0].lat, lon: d[0].lon }
    }

    const [f, t] = await Promise.all([geocode(from), geocode(to)])

    // Mappls distance matrix for accurate Indian road distances
    const dmUrl = `https://apis.mappls.com/advancedmaps/v1/${key}/distance_matrix/driving/${f.lon},${f.lat};${t.lon},${t.lat}?rtype=1&region=IND`
    const r = await fetch(dmUrl)
    const text = await r.text()
    let d: any
    try { d = JSON.parse(text) } catch { throw new Error(`Distance API error: ${text.slice(0, 200)}`) }
    const meters = d.results?.distances?.[0]?.[1]

    if (meters) {
      return new Response(JSON.stringify({ km: Math.round(meters / 1000) }), { headers })
    }

    // Fallback: OSRM if Mappls distance matrix fails
    const osrm = await fetch(`https://router.project-osrm.org/route/v1/driving/${f.lon},${f.lat};${t.lon},${t.lat}?overview=false`)
    const od = await osrm.json()
    if (od.code !== 'Ok') throw new Error('Route not found between these locations')
    const km = Math.round(od.routes[0].distance / 1000)
    return new Response(JSON.stringify({ km, source: 'osrm' }), { headers })

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers })
  }
}
