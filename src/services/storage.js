/**
 * Better Maps - Local Storage Service
 * Manages persistence for check-ins, geofences, and API keys using localStorage.
 */

const KEYS = {
  CHECK_INS: 'better_maps_checkins',
  GEOFENCES: 'better_maps_geofences',
  GEMINI_KEY: 'better_maps_gemini_key',
  SETTINGS: 'better_maps_settings'
};

export const storage = {
  // --- Gemini API Key ---
  getGeminiKey() {
    return localStorage.getItem(KEYS.GEMINI_KEY) || localStorage.getItem('batter_maps_gemini_key') || '';
  },

  saveGeminiKey(key) {
    if (!key) {
      localStorage.removeItem(KEYS.GEMINI_KEY);
      localStorage.removeItem('batter_maps_gemini_key');
    } else {
      localStorage.setItem(KEYS.GEMINI_KEY, key.trim());
    }
  },

  // --- Check-ins ---
  getCheckIns() {
    const data = localStorage.getItem(KEYS.CHECK_INS) || localStorage.getItem('batter_maps_checkins');
    return data ? JSON.parse(data) : [];
  },

  saveCheckIn(checkIn) {
    const list = this.getCheckIns();
    const newCheckIn = {
      id: checkIn.id || crypto.randomUUID(),
      name: checkIn.name || 'Local sem nome',
      address: checkIn.address || '',
      lat: parseFloat(checkIn.lat),
      lng: parseFloat(checkIn.lng),
      notes: checkIn.notes || '',
      category: checkIn.category || 'default',
      timestamp: checkIn.timestamp || new Date().toISOString()
    };
    list.push(newCheckIn);
    localStorage.setItem(KEYS.CHECK_INS, JSON.stringify(list));
    return newCheckIn;
  },

  deleteCheckIn(id) {
    const list = this.getCheckIns().filter(item => item.id !== id);
    localStorage.setItem(KEYS.CHECK_INS, JSON.stringify(list));
  },

  // --- Geofences ---
  getGeofences() {
    const data = localStorage.getItem(KEYS.GEOFENCES) || localStorage.getItem('batter_maps_geofences');
    return data ? JSON.parse(data) : [];
  },

  saveGeofence(geofence) {
    const list = this.getGeofences();
    const newGeofence = {
      id: geofence.id || crypto.randomUUID(),
      name: geofence.name || 'Alerta sem nome',
      lat: parseFloat(geofence.lat),
      lng: parseFloat(geofence.lng),
      radius: parseFloat(geofence.radius) || 200, // em metros
      timestamp: geofence.timestamp || new Date().toISOString()
    };
    list.push(newGeofence);
    localStorage.setItem(KEYS.GEOFENCES, JSON.stringify(list));
    return newGeofence;
  },

  deleteGeofence(id) {
    const list = this.getGeofences().filter(item => item.id !== id);
    localStorage.setItem(KEYS.GEOFENCES, JSON.stringify(list));
  },

  // --- App Settings ---
  getSettings() {
    const data = localStorage.getItem(KEYS.SETTINGS) || localStorage.getItem('batter_maps_settings');
    const defaults = {
      soundEnabled: true,
      alertRadius: 200, // default radius for new alerts in meters
      theme: 'dark'
    };
    return data ? { ...defaults, ...JSON.parse(data) } : defaults;
  },

  saveSettings(settings) {
    const current = this.getSettings();
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...current, ...settings }));
  }
};
