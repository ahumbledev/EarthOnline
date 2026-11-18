export type Point = [number, number];
export interface Building {
  ring: Point[];
  holes?: Point[][];
  height: number;
  landmark?: 'city-hall';
}
export interface Road {
  points: Point[];
  width: number;
}
export interface Park {
  ring: Point[];
  holes?: Point[][];
}
export interface CityDescriptor {
  id: string;
  name: string;
  area: string;
  attribution: string;
}
export interface CityMap extends CityDescriptor {
  origin: Point;
  bounds: [number, number, number, number];
  spawn: Point;
  buildings: Building[];
  roads: Road[];
  parks: Park[];
  roadAreas?: Park[];
  waterAreas?: Park[];
}
export const cities: CityDescriptor[] = [
  { id: 'philadelphia', name: 'Philadelphia', area: 'Center City', attribution: '© OpenStreetMap contributors · City of Philadelphia' },
  { id: 'hong-kong', name: 'Hong Kong', area: 'Mong Kok', attribution: '© OpenStreetMap contributors' },
  { id: 'hong-kong-yau-ma-tei', name: 'Hong Kong · Yau Ma Tei', area: 'Yau Ma Tei', attribution: '© OpenStreetMap contributors' },
  { id: 'hong-kong-tsim-sha-tsui', name: 'Hong Kong · Tsim Sha Tsui', area: 'Tsim Sha Tsui', attribution: '© OpenStreetMap contributors' },
  { id: 'tokyo', name: 'Tokyo', area: 'Shibuya', attribution: '© OpenStreetMap contributors' },
  { id: 'tokyo-akihabara-chuo-dori', name: 'Tokyo · Akihabara Chuo-dori', area: 'Akihabara Chuo-dori', attribution: '© OpenStreetMap contributors' },
  { id: 'tokyo-kabukicho', name: 'Tokyo · Kabukicho', area: 'Kabukicho', attribution: '© OpenStreetMap contributors' },
  { id: 'tokyo-ueno-ameyoko', name: 'Tokyo · Ueno Ameyoko', area: 'Ueno Ameyoko', attribution: '© OpenStreetMap contributors' },
  { id: 'montreal', name: 'Montréal', area: 'Old Montréal', attribution: '© OpenStreetMap contributors' },
  { id: 'melbourne', name: 'Melbourne', area: 'Central business district', attribution: 'City of Melbourne' },
  { id: 'helsinki', name: 'Helsinki', area: 'South Helsinki', attribution: 'City of Helsinki · © OpenStreetMap contributors' },
];
export async function loadCity(id: string): Promise<CityMap> {
  const city = cities.find(entry => entry.id === id);
  if (!city) throw new RangeError('Unknown city');
  const response = await fetch(`${import.meta.env.BASE_URL}maps/${id}.json`);
  if (!response.ok) throw new Error(`Cannot load ${city.name} (${response.status})`);
  return { ...await response.json(), ...city };
}
