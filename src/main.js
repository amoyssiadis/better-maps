/**
 * Better Maps - Main Application Script (Google Maps Dark Edition)
 * Integrates Google Maps, Geolocation simulation, Geofencing Alerts, and Gemini AI.
 */

import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { storage } from './services/storage';
import { gemini } from './services/gemini';

// --- State Variables ---
let map = null;
let googleInstance = null;
let userMarker = null;
let simulatedLocation = { lat: -23.550520, lng: -46.633308 }; // Default: Praça da Sé, São Paulo

// Map mode state: 'dark' vs 'hybrid'
let currentMapLayerMode = 'dark';

// Maps Directions Services
let directionsService = null;
let directionsRenderer = null;

// Track map drawings and markers
const checkInMarkers = new Map();
const geofenceDrawings = new Map(); // Store { circle, marker } objects
let tempClickMarker = null; // Temporary marker to show where the user clicked to add check-in/alert

// Active Route Metadata for Gemini Context
let activeRouteData = null;

// Geofencing trigger cooldown tracker
const geofenceCooldowns = new Set();

// --- Dark Mode Maps Styling (Google Dark Palette) ---
const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "on" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }]
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bdbdbd" }]
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#181818" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1b1b1b" }]
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#2c2c2c" }]
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }]
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#373737" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3c3c3c" }]
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry",
    stylers: [{ color: "#4e4e4e" }]
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#000000" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3d3d3d" }]
  }
];

// --- Audio Synth Helper (Web Audio API) ---
function playAlertSound() {
  if (!storage.getSettings().soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    const playBeep = (time, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0.1, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.15);
    };
    
    playBeep(ctx.currentTime, 880); 
    playBeep(ctx.currentTime + 0.12, 1200); 
  } catch (e) {
    console.error("Erro ao tocar alerta sonoro:", e);
  }
}

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize AI key if saved
  gemini.init();

  // Load Google Maps SDK
  setOptions({
    key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    v: 'weekly'
  });

  try {
    await Promise.all([
      importLibrary('maps'),
      importLibrary('places'),
      importLibrary('geocoding'),
      importLibrary('routes')
    ]);
    googleInstance = window.google;
    initMap();
    initAutocomplete();
    setupEventListeners();
    
    // Attempt to get user's real geolocation to center map initially
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          simulatedLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          updateUserLocationOnMap(simulatedLocation);
          map.setCenter(simulatedLocation);
        },
        (error) => console.log("Real GPS denied or unavailable. Using default location.", error),
        { enableHighAccuracy: true }
      );
    }
  } catch (error) {
    console.error("Error loading Google Maps API:", error);
    showToast("Erro de Carregamento", "Não foi possível carregar o Google Maps. Verifique sua chave de API.");
  }
});

// --- Map Initialization ---
function initMap() {
  const mapElement = document.getElementById('map');
  
  map = new googleInstance.maps.Map(mapElement, {
    center: simulatedLocation,
    zoom: 15,
    styles: darkMapStyle,
    disableDefaultUI: true, // We use custom floating action controls
    zoomControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });

  // Setup Directions
  directionsService = new googleInstance.maps.DirectionsService();
  directionsRenderer = new googleInstance.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: '#8ab4f8',
      strokeWeight: 6,
      strokeOpacity: 0.9
    }
  });

  // Create simulated user location marker
  userMarker = new googleInstance.maps.Marker({
    position: simulatedLocation,
    map: map,
    title: "Sua Posição Simulada",
    icon: {
      path: googleInstance.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#8ab4f8',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3
    }
  });

  // Click handler on map to simulate GPS movement
  map.addListener('click', (event) => {
    const clickedLat = event.latLng.lat();
    const clickedLng = event.latLng.lng();
    
    // 1. Move User simulated avatar
    simulatedLocation = { lat: clickedLat, lng: clickedLng };
    updateUserLocationOnMap(simulatedLocation);

    // 2. Add temporary marker for form inputs
    updateTempMarker(simulatedLocation);

    // Populate coordinates into forms depending on active tab
    const activeTabBtn = document.querySelector('.panel-tabs .tab-btn.active');
    const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'tab-checkin';

    if (activeTab === 'tab-checkin') {
      document.getElementById('checkin-lat').value = clickedLat.toFixed(6);
      document.getElementById('checkin-lng').value = clickedLng.toFixed(6);
      
      // Reverse Geocode to get address for check-in
      reverseGeocode(simulatedLocation, (address) => {
        document.getElementById('checkin-address').value = address;
        document.getElementById('checkin-name').placeholder = `Check-in perto de: ${address.split(',')[0]}`;
      });
    } else if (activeTab === 'tab-alerts') {
      document.getElementById('alert-lat').value = clickedLat.toFixed(6);
      document.getElementById('alert-lng').value = clickedLng.toFixed(6);
    }
    
    // Open drawer panel if collapsed when user clicks map to make check-in/alert
    const drawer = document.getElementById('dashboard-panel');
    if (drawer.classList.contains('collapsed')) {
      drawer.classList.remove('collapsed');
    }

    // Check geofences against new position
    checkGeofences(simulatedLocation);
  });

  // Load initial check-ins and geofences from storage
  loadSavedData();
}

// --- Autocomplete Setup ---
function initAutocomplete() {
  const searchInput = document.getElementById('address-search');
  const originInput = document.getElementById('route-origin');
  const destInput = document.getElementById('route-destination');

  const searchAutocomplete = new googleInstance.maps.places.Autocomplete(searchInput);
  searchAutocomplete.bindTo('bounds', map);
  
  searchAutocomplete.addListener('place_changed', () => {
    const place = searchAutocomplete.getPlace();
    if (!place.geometry || !place.geometry.location) return;

    map.setCenter(place.geometry.location);
    map.setZoom(16);
    
    // Update temp coords to this place
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const coords = { lat, lng };

    updateTempMarker(coords);

    // Autofill forms
    document.getElementById('checkin-lat').value = lat.toFixed(6);
    document.getElementById('checkin-lng').value = lng.toFixed(6);
    document.getElementById('checkin-address').value = place.formatted_address || place.name;
    document.getElementById('checkin-name').value = place.name;
  });

  // Setup Autocomplete for routes
  new googleInstance.maps.places.Autocomplete(originInput);
  new googleInstance.maps.places.Autocomplete(destInput);
}

// --- Geolocation Simulation engine ---
function updateUserLocationOnMap(coords) {
  userMarker.setPosition(coords);
  document.getElementById('sim-coords').innerText = `Lat: ${coords.lat.toFixed(6)}, Lng: ${coords.lng.toFixed(6)}`;
}

function updateTempMarker(coords) {
  if (tempClickMarker) {
    tempClickMarker.setPosition(coords);
  } else {
    tempClickMarker = new googleInstance.maps.Marker({
      position: coords,
      map: map,
      icon: {
        path: googleInstance.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        fillColor: '#c58af9',
        fillOpacity: 0.95,
        strokeColor: '#fff',
        strokeWeight: 1.5
      },
      title: "Ponto Selecionado"
    });
  }
}

function removeTempMarker() {
  if (tempClickMarker) {
    tempClickMarker.setMap(null);
    tempClickMarker = null;
  }
}

// Reverse Geocoding Helper
function reverseGeocode(latlng, callback) {
  const geocoder = new googleInstance.maps.Geocoder();
  geocoder.geocode({ location: latlng }, (results, status) => {
    if (status === "OK" && results[0]) {
      callback(results[0].formatted_address);
    } else {
      callback("Endereço desconhecido");
    }
  });
}

// --- Save & Load Data logic ---
function loadSavedData() {
  // Clear previous markers/circles
  checkInMarkers.forEach(marker => marker.setMap(null));
  checkInMarkers.clear();
  
  geofenceDrawings.forEach(d => {
    d.circle.setMap(null);
    d.marker.setMap(null);
  });
  geofenceDrawings.clear();

  // Load check-ins
  const checkIns = storage.getCheckIns();
  const checkinsContainer = document.getElementById('checkins-list');
  checkinsContainer.innerHTML = '';

  if (checkIns.length === 0) {
    checkinsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-map-pin"></i>
        <span>Nenhum check-in salvo. Clique no mapa para marcar locais visitados.</span>
      </div>
    `;
  } else {
    checkIns.forEach(c => {
      // Add card to UI
      const card = createCheckInCard(c);
      checkinsContainer.appendChild(card);

      // Map Category Color
      const colors = { food: '#fde293', sightseeing: '#81c995', work: '#8ab4f8', home: '#f28b82', default: '#c58af9' };
      const color = colors[c.category] || colors.default;

      // Add marker to map
      const marker = new googleInstance.maps.Marker({
        position: { lat: c.lat, lng: c.lng },
        map: map,
        title: c.name,
        icon: {
          path: googleInstance.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor: '#ffffff',
          strokeWeight: 1.5
        }
      });

      // Marker Info Window
      const infoWindow = new googleInstance.maps.InfoWindow({
        content: `
          <div style="color: #1d1e21; padding: 4px;">
            <h4 style="margin: 0 0 4px 0; font-family: Inter, sans-serif; color: #202124;">${c.name}</h4>
            <p style="font-size: 0.75rem; color: #5f6368; margin: 0 0 6px 0;">${c.address}</p>
            <p style="font-size: 0.8rem; margin: 0 0 10px 0; font-style: italic; color: #3c4043;">"${c.notes || 'Sem anotações'}"</p>
            <button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 4px; background: #d93025;" onclick="window.deleteCheckInFromMarker('${c.id}')">
              Excluir Check-in
            </button>
          </div>
        `
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });

      checkInMarkers.set(c.id, marker);
    });
  }

  // Load geofences
  const geofences = storage.getGeofences();
  const alertsContainer = document.getElementById('alerts-list');
  alertsContainer.innerHTML = '';

  if (geofences.length === 0) {
    alertsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-shield-halved"></i>
        <span>Nenhum alerta cadastrado. Crie cercas virtuais para ser notificado ao se aproximar.</span>
      </div>
    `;
  } else {
    geofences.forEach(g => {
      // Add card to UI
      const card = createGeofenceCard(g);
      alertsContainer.appendChild(card);

      // Add Circle to Map
      const circle = new googleInstance.maps.Circle({
        strokeColor: '#f28b82',
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        fillColor: '#f28b82',
        fillOpacity: 0.15,
        map: map,
        center: { lat: g.lat, lng: g.lng },
        radius: g.radius
      });

      // Add Marker to Map
      const marker = new googleInstance.maps.Marker({
        position: { lat: g.lat, lng: g.lng },
        map: map,
        title: g.name,
        icon: {
          path: googleInstance.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: '#f28b82',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 1
        }
      });

      geofenceDrawings.set(g.id, { circle, marker });
    });
  }
}

// Global functions attached to window
window.deleteCheckInFromMarker = (id) => {
  storage.deleteCheckIn(id);
  loadSavedData();
};

function createCheckInCard(c) {
  const card = document.createElement('div');
  card.className = 'list-item-card';
  card.innerHTML = `
    <div class="list-item-header">
      <div class="list-item-title">
        <span class="category-dot cat-${c.category}"></span>
        ${c.name}
      </div>
      <div class="list-item-actions">
        <button class="icon-btn focus-item" title="Focar no mapa"><i class="fa-solid fa-crosshairs"></i></button>
        <button class="icon-btn delete delete-item" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>
    <div class="list-item-desc">${c.notes || 'Sem anotações.'}</div>
    <div class="list-item-meta">
      <span>${c.address ? c.address.split(',')[0] : 'Endereço Indisponível'}</span>
      <span>${new Date(c.timestamp).toLocaleDateString('pt-BR')}</span>
    </div>
  `;

  // Focus action
  card.querySelector('.focus-item').addEventListener('click', () => {
    map.panTo({ lat: c.lat, lng: c.lng });
    map.setZoom(16);
    checkInMarkers.get(c.id).setAnimation(googleInstance.maps.Animation.BOUNCE);
    setTimeout(() => checkInMarkers.get(c.id).setAnimation(null), 1500);
  });

  // Delete action
  card.querySelector('.delete-item').addEventListener('click', () => {
    storage.deleteCheckIn(c.id);
    loadSavedData();
  });

  return card;
}

function createGeofenceCard(g) {
  const card = document.createElement('div');
  card.className = 'list-item-card';
  card.style.borderLeft = '4px solid var(--gm-red)';
  card.innerHTML = `
    <div class="list-item-header">
      <div class="list-item-title" style="color: var(--gm-red);">
        <i class="fa-solid fa-bullseye"></i> ${g.name}
      </div>
      <div class="list-item-actions">
        <button class="icon-btn focus-item" title="Focar no mapa"><i class="fa-solid fa-crosshairs"></i></button>
        <button class="icon-btn delete delete-item" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>
    <div class="list-item-desc">Raio: <strong>${g.radius}m</strong></div>
    <div class="list-item-meta">
      <span>Coords: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}</span>
    </div>
  `;

  // Focus action
  card.querySelector('.focus-item').addEventListener('click', () => {
    map.panTo({ lat: g.lat, lng: g.lng });
    map.setZoom(15);
  });

  // Delete action
  card.querySelector('.delete-item').addEventListener('click', () => {
    storage.deleteGeofence(g.id);
    loadSavedData();
  });

  return card;
}

// --- Geofencing Evaluation Engine ---
function checkGeofences(userCoords) {
  const geofences = storage.getGeofences();
  if (geofences.length === 0) return;

  geofences.forEach(g => {
    const distance = getHaversineDistance(
      userCoords.lat, userCoords.lng,
      g.lat, g.lng
    );

    if (distance <= g.radius) {
      if (!geofenceCooldowns.has(g.id)) {
        triggerGeofenceAlert(g, distance);
      }
    } else {
      geofenceCooldowns.delete(g.id);
    }
  });
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function triggerGeofenceAlert(geofence, currentDistance) {
  geofenceCooldowns.add(geofence.id);
  playAlertSound();

  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'geofence-toast';
  toast.innerHTML = `
    <div class="toast-icon">
      <i class="fa-solid fa-triangle-exclamation"></i>
    </div>
    <div class="toast-body">
      <div class="toast-title">Cerca de Alerta: ${geofence.name}</div>
      <div class="toast-desc">Você está a <strong>${Math.round(currentDistance)} metros</strong> deste ponto!</div>
    </div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('dismissed');
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('dismissed');
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);

  container.appendChild(toast);
  addSystemMessageToChat(`ALERTA: O usuário entrou no raio da Cerca Virtual "${geofence.name}" (${Math.round(currentDistance)}m).`);
}

// --- Directions and Routing logic ---
function calculateRoute() {
  const origin = document.getElementById('route-origin').value.trim();
  const destination = document.getElementById('route-destination').value.trim();

  if (!destination) {
    showToast("Erro de Rota", "Você precisa definir pelo menos um destino.");
    return;
  }

  const startPoint = origin || simulatedLocation;

  const request = {
    origin: startPoint,
    destination: destination,
    travelMode: googleInstance.maps.TravelMode.DRIVING
  };

  directionsService.route(request, (result, status) => {
    if (status === googleInstance.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);
      
      const route = result.routes[0].legs[0];
      
      activeRouteData = {
        origin: route.start_address,
        destination: route.end_address,
        distance: route.distance.text,
        duration: route.duration.text,
        steps: route.steps.map(step => step.instructions.replace(/<[^>]*>/g, ''))
      };

      document.getElementById('route-summary').style.display = 'block';
      document.getElementById('route-details').innerHTML = `
        <p><strong>Origem:</strong> ${activeRouteData.origin}</p>
        <p><strong>Destino:</strong> ${activeRouteData.destination}</p>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; border-top: 1px solid var(--gm-border); padding-top: 8px;">
          <span>Distância: <strong>${activeRouteData.distance}</strong></span>
          <span>Tempo: <strong>${activeRouteData.duration}</strong></span>
        </div>
      `;

      document.getElementById('chat-status-text').innerText = `Rota ativa: ${activeRouteData.destination.split(',')[0]}`;
      
      const chatPanel = document.getElementById('chat-panel');
      if (chatPanel.classList.contains('collapsed')) {
        chatPanel.classList.remove('collapsed');
      }

      addSystemMessageToChat(`Nova rota traçada de ${activeRouteData.origin.split(',')[0]} para ${activeRouteData.destination.split(',')[0]}.`);
    } else {
      console.error("Directions query failed with status:", status);
      showToast("Falha na Rota", "Não foi possível traçar rota para as localizações inseridas.");
    }
  });
}

function clearRoute() {
  directionsRenderer.setDirections({ routes: [] });
  document.getElementById('route-origin').value = '';
  document.getElementById('route-destination').value = '';
  document.getElementById('route-summary').style.display = 'none';
  activeRouteData = null;
  document.getElementById('chat-status-text').innerText = 'Sem rota selecionada';
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  const drawer = document.getElementById('dashboard-panel');
  const toggleDrawerBtn = document.getElementById('toggle-drawer-btn');
  const closeDrawerBtn = document.getElementById('close-drawer-btn');
  const quickDirectionsBtn = document.getElementById('quick-directions-btn');

  // Helper to switch tab
  const switchTab = (tabId) => {
    document.querySelectorAll('.panel-tabs .tab-btn, #gmaps-category-chips .chip-btn').forEach(b => {
      if (b.dataset.tab === tabId) {
        b.classList.add('active');
      } else if (b.dataset.tab) {
        b.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const targetContent = document.getElementById(tabId);
    if (targetContent) {
      targetContent.classList.add('active');
    }
    removeTempMarker();
  };

  // Drawer Toggle buttons
  toggleDrawerBtn.addEventListener('click', () => {
    drawer.classList.toggle('collapsed');
  });

  closeDrawerBtn.addEventListener('click', () => {
    drawer.classList.add('collapsed');
  });

  quickDirectionsBtn.addEventListener('click', () => {
    drawer.classList.remove('collapsed');
    switchTab('tab-routes');
  });

  // Category Chips & Tab Navigation switcher
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      drawer.classList.remove('collapsed');
      switchTab(btn.dataset.tab);
    });
  });

  // Quick search chips (Restaurantes, Cafés, Postos, etc.)
  document.querySelectorAll('[data-quick-search]').forEach(chip => {
    chip.addEventListener('click', () => {
      const searchTerm = chip.dataset.quick-search;
      const searchInput = document.getElementById('address-search');
      searchInput.value = searchTerm;
      
      // Perform Places Service search near simulated location
      const service = new googleInstance.maps.places.PlacesService(map);
      service.textSearch({
        location: simulatedLocation,
        radius: 3000,
        query: searchTerm
      }, (results, status) => {
        if (status === googleInstance.maps.places.PlacesServiceStatus.OK && results.length > 0) {
          map.panTo(results[0].geometry.location);
          map.setZoom(15);
          updateTempMarker(results[0].geometry.location);
          showToast("Encontrado", `${results[0].name} - ${results[0].formatted_address}`);
        } else {
          showToast("Busca", `Buscando por ${searchTerm} na região...`);
        }
      });
    });
  });

  // Bottom-Right Floating Map Controls
  document.getElementById('btn-recenter').addEventListener('click', () => {
    map.panTo(simulatedLocation);
    map.setZoom(16);
    showToast("GPS Re-centrado", "Mapa centrado na sua posição simulada.");
  });

  document.getElementById('btn-toggle-layer').addEventListener('click', () => {
    if (currentMapLayerMode === 'dark') {
      currentMapLayerMode = 'hybrid';
      map.setMapTypeId('hybrid');
      map.setOptions({ styles: null });
      showToast("Modo de Mapa", "Alternado para Satélite Híbrido.");
    } else {
      currentMapLayerMode = 'dark';
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: darkMapStyle });
      showToast("Modo de Mapa", "Alternado para Escuro (Dark Mode).");
    }
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    map.setZoom(map.getZoom() + 1);
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    map.setZoom(map.getZoom() - 1);
  });

  // Settings Dialog handlers
  const settingsDialog = document.getElementById('settings-dialog');
  
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-gemini-key').value = storage.getGeminiKey();
    document.getElementById('settings-sound').checked = storage.getSettings().soundEnabled;
    settingsDialog.showModal();
  });

  document.getElementById('settings-cancel').addEventListener('click', () => {
    settingsDialog.close();
  });

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = document.getElementById('settings-gemini-key').value;
    const soundEnabled = document.getElementById('settings-sound').checked;
    
    storage.saveGeminiKey(key);
    storage.saveSettings({ soundEnabled });
    
    const success = gemini.init(key);
    settingsDialog.close();

    if (success) {
      showToast("Configurações Salvas", "Gemini AI inicializado com sucesso!");
    } else if (key) {
      showToast("Aviso", "Configurações salvas, mas houve falha ao inicializar o Gemini.");
    } else {
      showToast("Configurações Salvas", "Configurações atualizadas.");
    }
  });

  // Form Submit: Check-ins
  document.getElementById('checkin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const latVal = document.getElementById('checkin-lat').value;
    const lngVal = document.getElementById('checkin-lng').value;
    const name = document.getElementById('checkin-name').value;
    const notes = document.getElementById('checkin-notes').value;
    const category = document.getElementById('checkin-category').value;
    const address = document.getElementById('checkin-address').value;

    if (!latVal || !lngVal) {
      showToast("Selecione um local", "Por favor, clique no mapa primeiro para selecionar as coordenadas.");
      return;
    }

    const checkIn = {
      name,
      notes,
      category,
      lat: parseFloat(latVal),
      lng: parseFloat(lngVal),
      address
    };

    storage.saveCheckIn(checkIn);
    loadSavedData();
    removeTempMarker();

    document.getElementById('checkin-form').reset();
    document.getElementById('checkin-lat').value = '';
    document.getElementById('checkin-lng').value = '';
    document.getElementById('checkin-address').value = '';

    showToast("Check-in Realizado!", `Salvo: ${name}`);
  });

  // Form Submit: Geofencing Alerts
  document.getElementById('alert-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const latVal = document.getElementById('alert-lat').value;
    const lngVal = document.getElementById('alert-lng').value;
    const name = document.getElementById('alert-name').value;
    const radius = document.getElementById('alert-radius').value;

    if (!latVal || !lngVal) {
      showToast("Selecione um ponto", "Por favor, clique no mapa primeiro para definir o centro do alerta.");
      return;
    }

    const geofence = {
      name,
      lat: parseFloat(latVal),
      lng: parseFloat(lngVal),
      radius: parseInt(radius)
    };

    storage.saveGeofence(geofence);
    loadSavedData();
    removeTempMarker();

    document.getElementById('alert-form').reset();
    document.getElementById('alert-lat').value = '';
    document.getElementById('alert-lng').value = '';

    showToast("Alerta Cadastrado!", `Monitorando a área: ${name}`);
  });

  // Routes Action buttons
  document.getElementById('get-route-btn').addEventListener('click', calculateRoute);
  document.getElementById('clear-route-btn').addEventListener('click', clearRoute);
  
  document.getElementById('ai-route-insight-btn').addEventListener('click', () => {
    if (!activeRouteData) return;
    openChatPanel();
    sendChatMessage(`Me dê insights, recomendações de segurança e dicas sobre esta rota que acabei de traçar.`);
  });

  // AI Chat panel animations toggle
  const chatPanel = document.getElementById('chat-panel');
  const toggleChatBtn = document.getElementById('toggle-chat-btn');
  const closeChatBtn = document.getElementById('close-chat-btn');

  const openChatPanel = () => {
    chatPanel.classList.remove('collapsed');
  };

  const closeChatPanel = () => {
    chatPanel.classList.add('collapsed');
  };

  toggleChatBtn.addEventListener('click', openChatPanel);
  closeChatBtn.addEventListener('click', closeChatPanel);

  // Send Chat message events
  document.getElementById('send-chat-btn').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (msg) {
      sendChatMessage(msg);
      input.value = '';
    }
  });

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const msg = e.target.value.trim();
      if (msg) {
        sendChatMessage(msg);
        e.target.value = '';
      }
    }
  });
}

// --- AI Chat Logic & UI Rendering ---
async function sendChatMessage(userText) {
  appendMessageToChatUI(userText, 'user');

  if (!storage.getGeminiKey()) {
    appendMessageToChatUI('Erro: Gemini API Key não configurada. Clique no ícone de engrenagem no topo para inserir sua chave.', 'ai');
    return;
  }

  const chatMessages = document.getElementById('chat-messages');
  const typingBubble = document.createElement('div');
  typingBubble.className = 'chat-bubble ai';
  typingBubble.id = 'typing-indicator-bubble';
  typingBubble.innerHTML = `
    <div style="display: flex; gap: 4px; align-items: center; justify-content: center; height: 16px;">
      <i class="fa-solid fa-spinner fa-spin" style="color: var(--gm-blue);"></i> Pensando...
    </div>
  `;
  chatMessages.appendChild(typingBubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const context = {
    currentLocation: simulatedLocation,
    checkIns: storage.getCheckIns(),
    geofences: storage.getGeofences(),
    activeRoute: activeRouteData
  };

  try {
    const replyText = await gemini.sendMessage(userText, context);
    typingBubble.remove();
    appendMessageToChatUI(replyText, 'ai');
  } catch (error) {
    typingBubble.remove();
    appendMessageToChatUI(`Erro ao conectar com Gemini AI: ${error.message}`, 'ai');
  }
}

function appendMessageToChatUI(text, sender) {
  const chatMessages = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  
  if (sender === 'ai') {
    const formattedHtml = text
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/- (.*?)(<br>|$)/g, '• $1$2');
    bubble.innerHTML = formattedHtml;
  } else {
    bubble.innerText = text;
  }

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessageToChat(systemText) {
  const chatMessages = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble system';
  bubble.innerText = systemText;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showToast(title, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'geofence-toast';
  toast.style.borderLeftColor = 'var(--gm-blue)';
  toast.innerHTML = `
    <div class="toast-icon" style="color: var(--gm-blue);">
      <i class="fa-solid fa-circle-info"></i>
    </div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${message}</div>
    </div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('dismissed');
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('dismissed');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);

  container.appendChild(toast);
}
