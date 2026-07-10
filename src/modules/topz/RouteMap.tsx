import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icons broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface RouteMapProps {
  from: [number, number] | null  // [lat, lng]
  to: [number, number] | null
  routeCoords: [number, number][]
  fromLabel: string
  toLabel: string
}

export function RouteMap({ from, to, routeCoords, fromLabel, toLabel }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.Layer[]>([])

  useEffect(() => {
    if (!containerRef.current) return
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, { zoomControl: true, attributionControl: false })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(mapRef.current)
      L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapRef.current)
    }
    const map = mapRef.current

    // Clear previous layers
    layersRef.current.forEach(l => l.remove())
    layersRef.current = []

    if (!from || !to) {
      map.setView([19.076, 72.877], 6)
      return
    }

    const goldIcon = (label: string) => L.divIcon({
      className: '',
      html: `<div style="background:#1a1a2e;border:2px solid #f0c040;border-radius:50% 50% 50% 0;width:28px;height:28px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
               <span style="transform:rotate(45deg);font-size:9px;font-weight:700;color:#f0c040;white-space:nowrap;">${label.slice(0,3).toUpperCase()}</span>
             </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    })

    const mFrom = L.marker(from, { icon: goldIcon(fromLabel) }).addTo(map)
    const mTo   = L.marker(to,   { icon: goldIcon(toLabel)   }).addTo(map)
    layersRef.current.push(mFrom, mTo)

    if (routeCoords.length > 1) {
      const poly = L.polyline(routeCoords, { color: '#f0c040', weight: 4, opacity: 0.85 }).addTo(map)
      layersRef.current.push(poly)
      map.fitBounds(poly.getBounds(), { padding: [32, 32] })
    } else {
      map.fitBounds(L.latLngBounds([from, to]), { padding: [48, 48] })
    }
  }, [from, to, routeCoords, fromLabel, toLabel])

  useEffect(() => {
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  return (
    <div ref={containerRef} style={{ height: 280, width: '100%', borderRadius: 12, overflow: 'hidden' }} />
  )
}
