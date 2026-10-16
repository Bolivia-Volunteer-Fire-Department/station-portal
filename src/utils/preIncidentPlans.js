// Pre-Incident Plans (PIPs) data model, normalization, validation, and offline caching.

export const PRE_INCIDENT_PLANS_COLLECTION = 'pre_incident_plans';
export const PRE_INCIDENT_PLANS_CACHE_KEY = 'sp_pre_incident_plans';
export const HYDRANTS_COLLECTION = 'hydrants';
export const HYDRANTS_CACHE_KEY = 'sp_hydrants';

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

export const OCCUPANCY_TYPES = [
  'Assembly',
  'Business',
  'Day Care',
  'Detention and Correctional',
  'Educational',
  'Health Care / Hospital',
  'Industrial / Factory',
  'Mercantile',
  'Mixed Occupancy',
  'Residential - Multi-family',
  'Residential - Single-family',
  'Residential Board and Care',
  'Storage / Warehouse',
  'Unusual / Special Structure',
  'Utility / Miscellaneous',
];

export const PROPERTY_USES = [
  'Multipurpose',
  'Retail Store',
  'Office Building',
  'Restaurant / Bar',
  'Warehouse / Distribution',
  'Manufacturing / Processing',
  'Place of Worship',
  'School / Educational Facility',
  'Medical / Dental Clinic',
  'Hospital / Inpatient',
  'Apartment / Condominium',
  'Hotel / Motel',
  'Single Family Dwelling',
  'Automotive Repair / Gas Station',
  'Recreational / Gymnasium',
  'Government / Municipal',
  'Agricultural / Barn',
  'Financial / Bank',
  'Other',
];

export const BUILDING_CONSTRUCTION_TYPES = [
  'Type I - Fire Resistive',
  'Type II - Non-Combustible',
  'Type III - Ordinary (Joisted Masonry)',
  'Type IV - Heavy Timber',
  'Type V - Wood Frame',
];

export const ROOF_TYPES = [
  'Flat',
  'Pitched',
  'Gable',
  'Hip',
  'Mansard',
  'Gambrel',
  'Sawtooth',
  'Arch / Barrel',
  'Dome',
  'Other',
];

export const ROOF_MATERIALS = [
  'Metal',
  'Asphalt Shingle',
  'Tile (Clay / Concrete)',
  'Built-Up / Tar & Gravel',
  'Membrane (EPDM / TPO / PVC)',
  'Slate',
  'Wood Shake / Shingle',
  'Concrete',
  'Other',
];

export const ROOF_CONSTRUCTIONS = [
  'Wood beam',
  'Wood truss',
  'Steel truss',
  'Open-web steel joist',
  'Concrete / Precast',
  'Heavy timber',
  'Engineered wood I-joist',
  'Other',
];

export const HYDRANT_STATUSES = [
  { value: 'in-service', label: 'In Service' },
  { value: 'out-of-service', label: 'Out of Service' },
];

export const HYDRANT_TYPES = [
  { value: 'dry', label: 'Dry Barrel' },
  { value: 'wet', label: 'Wet Barrel' },
];

// Helper to auto-generate an Occupancy ID if none provided
export const generateOccupancyId = () => {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const time = Date.now().toString(36).substring(4, 7).toUpperCase();
  return `OCC-${year}-${rand}${time}`;
};

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Coordinate precision matching districtMap: 6 decimal places (~11cm)
export const roundCoordinate = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  const factor = 10 ** 6;
  const rounded = Math.round(number * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const normalizeContact = (c) => ({
  id: str(c?.id || Math.random().toString(36).substring(2, 9), 50),
  name: str(c?.name, 100),
  address: str(c?.address, 200),
  phone: str(c?.phone, 50),
  description: str(c?.description, 200),
});

export const normalizeHydrant = (h) => {
  const lat = numOrNull(h?.latitude ?? h?.lat);
  const lng = numOrNull(h?.longitude ?? h?.lng);
  const validPos = Number.isFinite(lat) && Number.isFinite(lng);

  return {
    id: str(h?.id, 50),
    hydrant_id: str(h?.hydrant_id || h?.id, 50),
    address: str(h?.address, 200),
    latitude: validPos ? roundCoordinate(lat) : null,
    longitude: validPos ? roundCoordinate(lng) : null,
    distance: str(h?.distance, 50),
    flow: numOrNull(h?.flow),
    status: h?.status === 'out-of-service' ? 'out-of-service' : 'in-service',
    type: h?.type === 'wet' ? 'wet' : 'dry',
    notes: str(h?.notes, 500),
  };
};

/**
 * Calculates straight-line distance in feet between two lat/lng coordinates (Haversine formula).
 */
export const calculateDistanceFeet = (lat1, lon1, lat2, lon2) => {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (!Number.isFinite(nLat1) || !Number.isFinite(nLon1) || !Number.isFinite(nLat2) || !Number.isFinite(nLon2)) {
    return null;
  }
  const R = 20902231; // Mean radius of the Earth in feet (~6,371,000 meters * 3.28084)
  const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
  const dLon = ((nLon2 - nLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((nLat1 * Math.PI) / 180) *
      Math.cos((nLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

export const formatDistance = (feet) => {
  if (feet === null || feet === undefined || !Number.isFinite(Number(feet))) return '';
  const num = Number(feet);
  if (num < 1000) {
    return `${num} ft`;
  }
  const miles = (num / 5280).toFixed(1);
  return `${miles} mi (${num} ft)`;
};

export const preIncidentPlanProblem = (plan = {}) => {
  const name = str(plan.occupancy_name, 150);
  if (!name) {
    return 'An Occupancy Name is required for a Pre-Incident Plan.';
  }
  const lat = Number(plan.latitude);
  const lng = Number(plan.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'A valid map position (latitude and longitude) is required.';
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return 'The map position is outside the planet (-90 to 90 lat, -180 to 180 lng).';
  }
  return '';
};

export const normalizePreIncidentPlan = (raw = {}, defaultStation = '') => {
  const source = raw || {};
  const lat = Number(source.latitude);
  const lng = Number(source.longitude);
  const validPos = Number.isFinite(lat) && Number.isFinite(lng);

  return {
    id: str(source.id, 100),
    // Occupancy Information
    occupancy_id: str(source.occupancy_id, 100) || generateOccupancyId(),
    occupancy_name: str(source.occupancy_name, 150),
    address1: str(source.address1, 150),
    address2: str(source.address2, 100),
    city: str(source.city, 100),
    state: str(source.state, 10),
    zip_code: str(source.zip_code, 20),
    latitude: validPos ? roundCoordinate(lat) : null,
    longitude: validPos ? roundCoordinate(lng) : null,
    occupancy_type: str(source.occupancy_type, 100),
    property_use: str(source.property_use, 100),
    primary_phone: str(source.primary_phone, 50),
    primary_email: str(source.primary_email, 120),
    primary_fax: str(source.primary_fax, 50),
    iso_id: str(source.iso_id, 100),
    utility_billing_number: str(source.utility_billing_number, 100),
    national_grid: str(source.national_grid, 100),
    business_license_number: str(source.business_license_number, 100),
    assessor_parcel_number: str(source.assessor_parcel_number, 100),
    assessed_value: numOrNull(source.assessed_value),
    year_built: numOrNull(source.year_built),
    assigned_inspector: str(source.assigned_inspector, 100),
    critical_infrastructure: str(source.critical_infrastructure, 200),
    occupancy_zone: str(source.occupancy_zone, 100),
    station: str(source.station, 100) || str(defaultStation, 100),

    // Contacts (array)
    contacts: Array.isArray(source.contacts) ? source.contacts.map(normalizeContact) : [],

    // Prefire Plan
    building_height: numOrNull(source.building_height),
    building_width: numOrNull(source.building_width),
    building_length: numOrNull(source.building_length),
    floors: numOrNull(source.floors),
    square_footage: numOrNull(source.square_footage),
    needed_fire_flow: numOrNull(source.needed_fire_flow),
    basement_present: source.basement_present === true || String(source.basement_present).toLowerCase() === 'true',
    roof_type: str(source.roof_type, 100),
    roof_material: str(source.roof_material, 100),
    roof_construction: str(source.roof_construction, 100),
    master_key_location: str(source.master_key_location, 200),
    electrical_panel_location: str(source.electrical_panel_location, 200),
    other_location_info: str(source.other_location_info, 500),
    hazmat: str(source.hazmat, 500),
    building_access: str(source.building_access, 500),
    ventilation_problems: str(source.ventilation_problems, 500),
    hours_of_occupancy: str(source.hours_of_occupancy, 200),
    building_construction_type: str(source.building_construction_type, 150),
    fire_alarm_panel_location: str(source.fire_alarm_panel_location, 200),
    gas_lpg_shutoff_location: str(source.gas_lpg_shutoff_location, 200),
    exposure_info: str(source.exposure_info, 500),
    access_problems: str(source.access_problems, 500),
    prefire_plan_notes: str(source.prefire_plan_notes, 2000),

    // Fire Protection Systems
    fdc_locations: str(source.fdc_locations, 300),
    sprinkler_room_location: str(source.sprinkler_room_location, 300),
    water_supply_info: str(source.water_supply_info, 500),

    // Nearby Hydrants (array)
    nearby_hydrants: Array.isArray(source.nearby_hydrants) ? source.nearby_hydrants.map(normalizeHydrant) : [],

    // Chemical Inventory (long text)
    chemical_inventory: str(source.chemical_inventory, 10000),

    // Attached Diagrams & Documents (array of file objects)
    files: Array.isArray(source.files) ? source.files : [],

    created_at: str(source.created_at, 50),
    updated_at: str(source.updated_at, 50),
    created_by: str(source.created_by, 100),
  };
};

export const preIncidentPlanFields = (input = {}, defaultStation = '') => {
  const norm = normalizePreIncidentPlan(input, defaultStation);
  const problem = preIncidentPlanProblem(norm);
  if (problem) throw new Error(problem);
  return {
    occupancy_id: norm.occupancy_id,
    occupancy_name: norm.occupancy_name,
    address1: norm.address1,
    address2: norm.address2,
    city: norm.city,
    state: norm.state,
    zip_code: norm.zip_code,
    latitude: norm.latitude,
    longitude: norm.longitude,
    occupancy_type: norm.occupancy_type,
    property_use: norm.property_use,
    primary_phone: norm.primary_phone,
    primary_email: norm.primary_email,
    primary_fax: norm.primary_fax,
    iso_id: norm.iso_id,
    utility_billing_number: norm.utility_billing_number,
    national_grid: norm.national_grid,
    business_license_number: norm.business_license_number,
    assessor_parcel_number: norm.assessor_parcel_number,
    assessed_value: norm.assessed_value,
    year_built: norm.year_built,
    assigned_inspector: norm.assigned_inspector,
    critical_infrastructure: norm.critical_infrastructure,
    occupancy_zone: norm.occupancy_zone,
    station: norm.station,

    contacts: norm.contacts,

    building_height: norm.building_height,
    building_width: norm.building_width,
    building_length: norm.building_length,
    floors: norm.floors,
    square_footage: norm.square_footage,
    needed_fire_flow: norm.needed_fire_flow,
    basement_present: norm.basement_present,
    roof_type: norm.roof_type,
    roof_material: norm.roof_material,
    roof_construction: norm.roof_construction,
    master_key_location: norm.master_key_location,
    electrical_panel_location: norm.electrical_panel_location,
    other_location_info: norm.other_location_info,
    hazmat: norm.hazmat,
    building_access: norm.building_access,
    ventilation_problems: norm.ventilation_problems,
    hours_of_occupancy: norm.hours_of_occupancy,
    building_construction_type: norm.building_construction_type,
    fire_alarm_panel_location: norm.fire_alarm_panel_location,
    gas_lpg_shutoff_location: norm.gas_lpg_shutoff_location,
    exposure_info: norm.exposure_info,
    access_problems: norm.access_problems,
    prefire_plan_notes: norm.prefire_plan_notes,

    fdc_locations: norm.fdc_locations,
    sprinkler_room_location: norm.sprinkler_room_location,
    water_supply_info: norm.water_supply_info,

    nearby_hydrants: norm.nearby_hydrants,
    chemical_inventory: norm.chemical_inventory,
    files: norm.files,
  };
};

// --------------------------------------------------------------------------------------------------------------
// Device Cache
// --------------------------------------------------------------------------------------------------------------
const cacheAvailable = () => {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
};

export const cachedPreIncidentPlans = () => {
  if (!cacheAvailable()) return [];
  try {
    const raw = localStorage.getItem(PRE_INCIDENT_PLANS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((p) => normalizePreIncidentPlan(p)) : [];
  } catch {
    return [];
  }
};

export const cachePreIncidentPlans = (rows) => {
  if (!cacheAvailable()) return false;
  try {
    if (!rows || !Array.isArray(rows)) {
      localStorage.removeItem(PRE_INCIDENT_PLANS_CACHE_KEY);
      return true;
    }
    localStorage.setItem(PRE_INCIDENT_PLANS_CACHE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
};

export const cachedHydrants = () => {
  if (!cacheAvailable()) return [];
  try {
    const raw = localStorage.getItem(HYDRANTS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((h) => normalizeHydrant(h)) : [];
  } catch {
    return [];
  }
};

export const cacheHydrants = (rows) => {
  if (!cacheAvailable()) return false;
  try {
    if (!rows || !Array.isArray(rows)) {
      localStorage.removeItem(HYDRANTS_CACHE_KEY);
      return true;
    }
    localStorage.setItem(HYDRANTS_CACHE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
};

// Sort pre-incident plans alphabetically by Occupancy Name
export const sortedPreIncidentPlans = (plans = []) =>
  (Array.isArray(plans) ? plans : [])
    .map((p) => normalizePreIncidentPlan(p))
    .filter((p) => p.occupancy_name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .sort((a, b) => a.occupancy_name.localeCompare(b.occupancy_name));

