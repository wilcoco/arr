import { useState, useEffect } from 'react'
import Map, { Marker, Source, Layer } from 'react-map-gl'
import { useGameStore } from './stores/gameStore'
import GuardianPanel from './components/GuardianPanel'
import TerritoryControls from './components/TerritoryControls'
import BattleModal from './components/BattleModal'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN'

export default function App() {
  const [viewState, setViewState] = useState({
    longitude: 127.0,
    latitude: 37.5,
    zoom: 15
  })

  const {
    userLocation,
    guardian,
    territories,
    setUserLocation
  } = useGameStore()

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords
          setUserLocation({ longitude, latitude })
          setViewState(prev => ({ ...prev, longitude, latitude }))
        },
        (err) => console.error('Geolocation error:', err),
        { enableHighAccuracy: true }
      )
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        {userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
          >
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#00ff88',
              border: '3px solid white',
              boxShadow: '0 0 10px #00ff88'
            }} />
          </Marker>
        )}

        {guardian && userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
            anchor="bottom"
          >
            <div style={{
              fontSize: 32,
              filter: 'drop-shadow(0 0 8px gold)'
            }}>
              {guardian.type === 'animal' ? '🦁' :
               guardian.type === 'robot' ? '🤖' : '✈️'}
            </div>
          </Marker>
        )}

        {territories.map(t => (
          <Source
            key={t.id}
            type="geojson"
            data={{
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [t.center.lng, t.center.lat]
              }
            }}
          >
            <Layer
              type="circle"
              paint={{
                'circle-radius': t.radius / 10,
                'circle-color': t.isOwn ? '#00ff88' : '#ff4444',
                'circle-opacity': 0.3
              }}
            />
          </Source>
        ))}
      </Map>

      <GuardianPanel />
      <TerritoryControls />
      <BattleModal />
    </div>
  )
}
