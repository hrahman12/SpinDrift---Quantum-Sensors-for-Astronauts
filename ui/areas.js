// Ten areas. Each has its own clothes and scene, and every exact spot inside an area is a real sub-place of
// data/locations.json (so its magnetic field, radiation note and Lean verdicts are real). An area can hold spots of
// more than one place (both space stations share one look). The clothes and scenery are a drawing choice.
export const AREAS = [
  { id: 'station', name: 'Space station', spots: ['iss.*', 'tiangong.*'], outfit: 'cabin', backdrop: 'orbit' },
  { id: 'spacewalk', name: 'Spacewalk in orbit', spots: ['iss_hotspots.*'], outfit: 'eva', backdrop: 'orbit' },
  { id: 'launch', name: 'Launch and splashdown', spots: ['earth_flight.baikonur', 'earth_flight.i4_splashdown'], outfit: 'launch', backdrop: { 'earth_flight.baikonur': 'steppe', 'earth_flight.i4_splashdown': 'ocean' } },
  { id: 'home', name: 'Training on Earth', spots: ['earth_flight.jsc'], outfit: 'everyday', backdrop: 'earth' },
  { id: 'antarctic', name: 'Antarctic station', spots: ['earth_analog.concordia'], outfit: 'cold', backdrop: 'antarctic' },
  { id: 'field', name: 'Arctic and desert field camps', spots: ['earth_analog.haughton', 'earth_analog.mdrs'], outfit: 'field', backdrop: { 'earth_analog.haughton': 'arctic', 'earth_analog.mdrs': 'desert' } },
  { id: 'undersea', name: 'Undersea habitat', spots: ['earth_analog.aquarius'], outfit: 'dive', backdrop: 'ocean' },
  { id: 'deep', name: 'Deep space: Gateway and Mars transit', spots: ['gateway.*', 'mars_transit.*'], outfit: 'flight', backdrop: 'deep_space' },
  { id: 'moon', name: 'Moon surface', spots: ['moon_south_pole.*', 'lunar_anomalies.*'], outfit: 'eva', backdrop: 'lunar' },
  { id: 'mars', name: 'Mars surface', spots: ['mars_surface.*'], outfit: 'eva', backdrop: 'mars' },
];
// the five older location ids, mapped as the server maps them
export const LEGACY = { iss: 'iss.destiny', gateway: 'gateway.halo', lunar_base: 'moon_south_pole.shackleton_rim', mars_transit: 'mars_transit.cruise', mars_surface: 'mars_surface.insight' };

const matches = (pattern, id) => (pattern.endsWith('.*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern);
export function areaOf(spotId) {
  const id = LEGACY[spotId] || spotId;
  return AREAS.find((a) => a.spots.some((p) => matches(p, id))) || AREAS[0];
}
// the sub-places of an area, in the order its patterns list them, from the places of data/locations.json
export function spotsOf(area, places) {
  const all = (places || []).flatMap((p) => (p.sub_places || []).map((s) => ({ ...s, place_name: p.name || s.place })));
  return area.spots.flatMap((pat) => all.filter((s) => matches(pat, s.id)));
}
export function lookOf(spotId) {
  const a = areaOf(spotId), id = LEGACY[spotId] || spotId;
  return { outfit: a.outfit, backdrop: typeof a.backdrop === 'string' ? a.backdrop : a.backdrop[id] || Object.values(a.backdrop)[0], area: a.id };
}
