import React, { useState } from 'react'
import api from '../../lib/api'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import './Qualify.css'

const pinIcon = L.icon({ iconUrl: markerIcon, shadowUrl: markerShadow, iconAnchor: [12, 41] })

function ClickToPin({ onPick }) {
    const [pos, setPos] = useState(null)
    useMapEvents({
        click(e) { setPos(e.latlng); onPick(e.latlng) },
    })
    return pos ? <Marker position={pos} icon={pinIcon} /> : null
}

function PinDropMap({ onConfirm }) {
    const [pin, setPin] = useState(null)
    return (
        <div>
            <MapContainer center={[39.5, -98.35]} zoom={4} style={{ height: 400, width: '100%' }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                />
                <ClickToPin onPick={setPin} />
            </MapContainer>
            <button disabled={!pin} onClick={() => onConfirm(pin)}>
                Confirm this Location
            </button>
        </div>
    )
}

function Qualify({ onClose, onQualified }) {
    const [street, setStreet] = useState('')
    const [city, setCity] = useState('')
    const [state, setState] = useState('')
    const [zip, setZip] = useState('')
    const [needsPin, setNeedsPin] = useState(false)
    const [error, setError] = useState(null)

    async function handleSubmit(e) {
        e.preventDefault()
        setError(null)
        try {
            const address = `${street}, ${city}, ${state} ${zip}`
            const res = await api.post('/api/users/me/jurisdictions/resolve', { address })
            if (res.data.status === 'needs_manual_pin') {
                setNeedsPin(true)
            } else {
                const officesRes = await api.get('/api/offices/relevant')
                onQualified?.(officesRes.data ?? [])
                onClose?.()
            }
        } catch (err) {
            console.error(err)
            setError('Something went wrong resolving your address.')
        }
    }

    async function handlePinConfirm({ lat, lng }) {
        setError(null)
        try {
            const res = await api.post('/api/users/me/jurisdictions/resolve-coords', { lat, lng })
            if (res.data.status === 'needs_manual_pin') {
                setError("We still couldn't place that pin — try moving it.")
            } else {
                const officesRes = await api.get('/api/offices/relevant')
                onQualified?.(officesRes.data ?? [])
                onClose?.()
            }
        } catch (err) {
            console.error(err)
            setError('Something went wrong resolving your location.')
        }
    }

    return (
        <div className='qualifyOverlay'>
            <div className='qualifyModal'>
                <button className='qualifyClose' onClick={onClose}>x</button>
                <h3>
                    Political offices are gatekept by jurisdiction based on your home address, so we need it
                    to show what you qualify for. We prioritize your safety above all else and immediately
                    delete your address after calculating your jurisdictions.
                </h3>
                {error && <p className='qualifyError'>{error}</p>}

                {!needsPin && (
                    <form onSubmit={handleSubmit}>
                        <label htmlFor='street'>Street</label>
                        <input id='street' type='text' value={street} onChange={(e) => setStreet(e.target.value)} />
                        <label htmlFor='city'>City</label>
                        <input id='city' type='text' value={city} onChange={(e) => setCity(e.target.value)} />
                        <label htmlFor='state'>State</label>
                        <input id='state' type='text' value={state} onChange={(e) => setState(e.target.value)} />
                        <label htmlFor='zip'>Zip</label>
                        <input id='zip' type='text' inputMode='numeric' value={zip} onChange={(e) => setZip(e.target.value)} />
                        <button type='submit'>Find my offices</button>
                    </form>
                )}

                {needsPin && (
                    <>
                        <p className='pinHelp'>
                            We couldn't pinpoint that address. Drop a pin on your home location so we can find
                            your districts. (Used only to find your jurisdictions — never stored.)
                        </p>
                        <PinDropMap onConfirm={handlePinConfirm} />
                    </>
                )}
            </div>
        </div>
    )
}

export default Qualify
