// Uniform-grid spatial index for lat/lng points.
// 평균 위도 기준 cosLat 한 번만 계산해 모든 셀 크기를 일관되게 잡음 (한국 한정 사용 가정).
// 사용법:
//   const idx = buildSpatialIndex(items, t => ({ lat, lng }), cellSizeMeters)
//   for (const other of idx.neighbors(lat, lng)) { ... }   // 인접 9칸의 후보 반환

const M_PER_DEG_LAT = 111_000

function buildSpatialIndex(items, getLatLng, cellSizeMeters) {
  if (!items || items.length === 0) {
    return {
      cellSize: cellSizeMeters,
      neighbors: function* () {},
      forEachPair: function () {}
    }
  }

  let sumLat = 0
  let count = 0
  for (const it of items) {
    const ll = getLatLng(it)
    if (!ll) continue
    sumLat += ll.lat
    count++
  }
  const avgLat = count > 0 ? sumLat / count : 37
  const cosLat = Math.max(0.1, Math.cos(avgLat * Math.PI / 180))

  const cellLatDeg = cellSizeMeters / M_PER_DEG_LAT
  const cellLngDeg = cellSizeMeters / (M_PER_DEG_LAT * cosLat)

  const grid = new Map()
  const cellOf = (lat, lng) => [Math.floor(lng / cellLngDeg), Math.floor(lat / cellLatDeg)]

  for (const it of items) {
    const ll = getLatLng(it)
    if (!ll) continue
    const [cx, cy] = cellOf(ll.lat, ll.lng)
    const key = cx + '|' + cy
    let bucket = grid.get(key)
    if (!bucket) { bucket = []; grid.set(key, bucket) }
    bucket.push(it)
  }

  function* neighbors(lat, lng) {
    const [cx, cy] = cellOf(lat, lng)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get((cx + dx) + '|' + (cy + dy))
        if (arr) for (const it of arr) yield it
      }
    }
  }

  // 모든 (a, b) 후보 쌍을 한 번씩만 콜백 — 자기 자신/중복 제외.
  // 호출자는 정확한 거리 검사를 직접 수행해야 한다.
  function forEachPair(getId, fn) {
    const seen = new Set()
    for (const a of items) {
      const ll = getLatLng(a)
      if (!ll) continue
      const aId = getId(a)
      for (const b of neighbors(ll.lat, ll.lng)) {
        const bId = getId(b)
        if (aId === bId) continue
        const key = aId < bId ? aId + '|' + bId : bId + '|' + aId
        if (seen.has(key)) continue
        seen.add(key)
        fn(a, b)
      }
    }
  }

  return { cellSize: cellSizeMeters, neighbors, forEachPair }
}

module.exports = { buildSpatialIndex }
