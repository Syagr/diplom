import { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export default function MapPage() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [centers, setCenters] = useState<Array<{ id: number; name: string; lat: number; lng: number; distanceKm?: number }>>([]);

  const defaultCoords = useMemo(() => ({ lat: 50.45, lng: 30.523 }), []); // Kyiv

  useEffect(() => {
    const m = L.map('map', { center: [defaultCoords.lat, defaultCoords.lng], zoom: 12 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    setMap(m);
    return () => { m.remove(); };
  }, [defaultCoords]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // In dev, API may be on another port; enable CORS accordingly
        const q = new URLSearchParams({ lat: String(defaultCoords.lat), lng: String(defaultCoords.lng), limit: '10' }).toString();
  const res = await axios.get(`${API_BASE}/api/service-centers/nearby?${q}`, { withCredentials: true });
  const items = res.data?.items || [];
  if (!cancelled) setCenters(items);
      } catch (e) {
        console.error('Failed to load centers', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [defaultCoords]);

  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    centers.forEach(c => {
      const marker = L.marker([c.lat, c.lng]).addTo(layer);
      marker.bindPopup(`<b>${c.name}</b>${c.distanceKm ? `<br/>${c.distanceKm.toFixed(2)} km` : ''}`);
    });
    return () => { layer.remove(); };
  }, [map, centers]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-3 border-b">
        <h1 className="text-xl font-semibold">Nearby Service Centers</h1>
        <p className="text-sm text-gray-600">Centered on Kyiv (demo). Uses /api/service-centers/nearby.</p>
      </div>
      <div id="map" style={{ width: '100%', height: 'calc(100vh - 80px)' }} />
    </div>
  );
}
