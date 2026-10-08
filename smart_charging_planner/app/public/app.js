// Readable duration: "45 min", "3 h 20 min", "3 d 14 h".
function durationText(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const rest = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

// All URLs are relative, so requests go through the ingress path.

    // Material Design Icons (as used by Home Assistant and Mushroom), from @mdi/js 7.4.47 (Apache-2.0).
    const ICONS = {"overview": "M19,5V7H15V5H19M9,5V11H5V5H9M19,13V19H15V13H19M9,17V19H5V17H9M21,3H13V9H21V3M11,3H3V13H11V3M21,11H13V21H21V11M11,15H3V21H11V15Z", "departures": "M15,13H16.5V15.82L18.94,17.23L18.19,18.53L15,16.69V13M19,8H5V19H9.67C9.24,18.09 9,17.07 9,16A7,7 0 0,1 16,9C17.07,9 18.09,9.24 19,9.67V8M5,21C3.89,21 3,20.1 3,19V5C3,3.89 3.89,3 5,3H6V1H8V3H16V1H18V3H19A2,2 0 0,1 21,5V11.1C22.24,12.36 23,14.09 23,16A7,7 0 0,1 16,23C14.09,23 12.36,22.24 11.1,21H5M16,11.15A4.85,4.85 0 0,0 11.15,16C11.15,18.68 13.32,20.85 16,20.85A4.85,4.85 0 0,0 20.85,16C20.85,13.32 18.68,11.15 16,11.15Z", "savings": "M15 10C15 9.45 15.45 9 16 9C16.55 9 17 9.45 17 10S16.55 11 16 11 15 10.55 15 10M8 9H13V7H8V9M22 7.5V14.47L19.18 15.41L17.5 21H12V19H10V21H4.5C4.5 21 2 12.54 2 9.5S4.46 4 7.5 4H12.5C13.41 2.79 14.86 2 16.5 2C17.33 2 18 2.67 18 3.5C18 3.71 17.96 3.9 17.88 4.08C17.74 4.42 17.62 4.81 17.56 5.23L19.83 7.5H22M20 9.5H19L15.5 6C15.5 5.35 15.59 4.71 15.76 4.09C14.79 4.34 14 5.06 13.67 6H7.5C5.57 6 4 7.57 4 9.5C4 11.38 5.22 16.15 6 19H8V17H14V19H16L17.56 13.85L20 13.03V9.5Z", "log": "M7,5H21V7H7V5M7,13V11H21V13H7M4,4.5A1.5,1.5 0 0,1 5.5,6A1.5,1.5 0 0,1 4,7.5A1.5,1.5 0 0,1 2.5,6A1.5,1.5 0 0,1 4,4.5M4,10.5A1.5,1.5 0 0,1 5.5,12A1.5,1.5 0 0,1 4,13.5A1.5,1.5 0 0,1 2.5,12A1.5,1.5 0 0,1 4,10.5M7,19V17H21V19H7M4,16.5A1.5,1.5 0 0,1 5.5,18A1.5,1.5 0 0,1 4,19.5A1.5,1.5 0 0,1 2.5,18A1.5,1.5 0 0,1 4,16.5Z", "settings": "M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M10,22C9.75,22 9.54,21.82 9.5,21.58L9.13,18.93C8.5,18.68 7.96,18.34 7.44,17.94L4.95,18.95C4.73,19.03 4.46,18.95 4.34,18.73L2.34,15.27C2.21,15.05 2.27,14.78 2.46,14.63L4.57,12.97L4.5,12L4.57,11L2.46,9.37C2.27,9.22 2.21,8.95 2.34,8.73L4.34,5.27C4.46,5.05 4.73,4.96 4.95,5.05L7.44,6.05C7.96,5.66 8.5,5.32 9.13,5.07L9.5,2.42C9.54,2.18 9.75,2 10,2H14C14.25,2 14.46,2.18 14.5,2.42L14.87,5.07C15.5,5.32 16.04,5.66 16.56,6.05L19.05,5.05C19.27,4.96 19.54,5.05 19.66,5.27L21.66,8.73C21.79,8.95 21.73,9.22 21.54,9.37L19.43,11L19.5,12L19.43,13L21.54,14.63C21.73,14.78 21.79,15.05 21.66,15.27L19.66,18.73C19.54,18.95 19.27,19.04 19.05,18.95L16.56,17.95C16.04,18.34 15.5,18.68 14.87,18.93L14.5,21.58C14.46,21.82 14.25,22 14,22H10M11.25,4L10.88,6.61C9.68,6.86 8.62,7.5 7.85,8.39L5.44,7.35L4.69,8.65L6.8,10.2C6.4,11.37 6.4,12.64 6.8,13.8L4.68,15.36L5.43,16.66L7.86,15.62C8.63,16.5 9.68,17.14 10.87,17.38L11.24,20H12.76L13.13,17.39C14.32,17.14 15.37,16.5 16.14,15.62L18.57,16.66L19.32,15.36L17.2,13.81C17.6,12.64 17.6,11.37 17.2,10.2L19.31,8.65L18.56,7.35L16.15,8.39C15.38,7.5 14.32,6.86 13.12,6.62L12.75,4H11.25Z", "car": "M18.92 2C18.72 1.42 18.16 1 17.5 1H6.5C5.84 1 5.29 1.42 5.08 2L3 8V16C3 16.55 3.45 17 4 17H5C5.55 17 6 16.55 6 16V15H18V16C18 16.55 18.45 17 19 17H20C20.55 17 21 16.55 21 16V8L18.92 2M6.85 3H17.14L18.22 6.11H5.77L6.85 3M19 13H5V8H19V13M7.5 9C8.33 9 9 9.67 9 10.5S8.33 12 7.5 12 6 11.33 6 10.5 6.67 9 7.5 9M16.5 9C17.33 9 18 9.67 18 10.5S17.33 12 16.5 12C15.67 12 15 11.33 15 10.5S15.67 9 16.5 9M7 20H11V18L17 21H13V23L7 20Z", "charger": "M19.77,7.23L19.78,7.22L16.06,3.5L15,4.56L17.11,6.67C16.17,7.03 15.5,7.93 15.5,9A2.5,2.5 0 0,0 18,11.5C18.36,11.5 18.69,11.42 19,11.29V18.5A1,1 0 0,1 18,19.5A1,1 0 0,1 17,18.5V14A2,2 0 0,0 15,12H14V5A2,2 0 0,0 12,3H6A2,2 0 0,0 4,5V21H14V13.5H15.5V18.5A2.5,2.5 0 0,0 18,21A2.5,2.5 0 0,0 20.5,18.5V9C20.5,8.31 20.22,7.68 19.77,7.23M18,10A1,1 0 0,1 17,9A1,1 0 0,1 18,8A1,1 0 0,1 19,9A1,1 0 0,1 18,10M8,18V13.5H6L10,6V11H12L8,18Z", "grid": "M8.28,5.45L6.5,4.55L7.76,2H16.23L17.5,4.55L15.72,5.44L15,4H9L8.28,5.45M18.62,8H14.09L13.3,5H10.7L9.91,8H5.38L4.1,10.55L5.89,11.44L6.62,10H17.38L18.1,11.45L19.89,10.56L18.62,8M17.77,22H15.7L15.46,21.1L12,15.9L8.53,21.1L8.3,22H6.23L9.12,11H11.19L10.83,12.35L12,14.1L13.16,12.35L12.81,11H14.88L17.77,22M11.4,15L10.5,13.65L9.32,18.13L11.4,15M14.68,18.12L13.5,13.64L12.6,15L14.68,18.12Z", "prices": "M15 18.5C12.5 18.5 10.32 17.08 9.24 15H15L16 13H8.58C8.53 12.67 8.5 12.34 8.5 12S8.53 11.33 8.58 11H15L16 9H9.24C10.32 6.92 12.5 5.5 15 5.5C16.61 5.5 18.09 6.09 19.23 7.07L21 5.3C19.41 3.87 17.3 3 15 3C11.08 3 7.76 5.5 6.5 9H3L2 11H6.06C6 11.33 6 11.66 6 12S6 12.67 6.06 13H3L2 15H6.5C7.76 18.5 11.08 21 15 21C17.31 21 19.41 20.13 21 18.7L19.22 16.93C18.09 17.91 16.62 18.5 15 18.5Z", "control": "M8 13C6.14 13 4.59 14.28 4.14 16H2V18H4.14C4.59 19.72 6.14 21 8 21S11.41 19.72 11.86 18H22V16H11.86C11.41 14.28 9.86 13 8 13M8 19C6.9 19 6 18.1 6 17C6 15.9 6.9 15 8 15S10 15.9 10 17C10 18.1 9.1 19 8 19M19.86 6C19.41 4.28 17.86 3 16 3S12.59 4.28 12.14 6H2V8H12.14C12.59 9.72 14.14 11 16 11S19.41 9.72 19.86 8H22V6H19.86M16 9C14.9 9 14 8.1 14 7C14 5.9 14.9 5 16 5S18 5.9 18 7C18 8.1 17.1 9 16 9Z", "status": "M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z", "bolt": "M11 15H6L13 1V9H18L11 23V15Z", "pause": "M14,19H18V5H14M6,19H10V5H6V19Z", "plug": "M16 7V3H14V7H10V3H8V7C7 7 6 8 6 9V14.5L9.5 18V21H14.5V18L18 14.5V9C18 8 17 7 16 7M16 13.67L13.09 16.59L12.67 17H11.33L10.92 16.59L8 13.67V9.09C8 9.06 8.06 9 8.09 9H15.92C15.95 9 16 9.06 16 9.09V13.67Z", "plugOff": "M22.11 21.46L2.39 1.73L1.11 3L6.25 8.14C6.1 8.41 6 8.7 6 9V14.5L9.5 18V21H14.5V18L15.31 17.2L20.84 22.73L22.11 21.46M13.09 16.59L12.67 17H11.33L10.92 16.59L8 13.67V9.89L13.89 15.78L13.09 16.59M12.2 9L10.2 7H14V3H16V7C17 7 18 8 18 9V14.5L17.85 14.65L16 12.8V9.09C16 9.06 15.95 9 15.92 9H12.2M10 6.8L8 4.8V3H10V6.8Z", "clock": "M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z", "alert": "M12,2L1,21H23M12,6L19.53,19H4.47M11,10V14H13V10M11,16V18H13V16", "check": "M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z", "battery": "M12,11H4V6H12M12.67,4H11V2H5V4H3.33A1.33,1.33 0 0,0 2,5.33V20.67C2,21.4 2.6,22 3.33,22H12.67C13.4,22 14,21.4 14,20.67V5.33A1.33,1.33 0 0,0 12.67,4M23,11H20V4L15,14H18V22L23,11Z", "cash": "M5,6H23V18H5V6M14,9A3,3 0 0,1 17,12A3,3 0 0,1 14,15A3,3 0 0,1 11,12A3,3 0 0,1 14,9M9,8A2,2 0 0,1 7,10V14A2,2 0 0,1 9,16H19A2,2 0 0,1 21,14V10A2,2 0 0,1 19,8H9M1,10H3V20H19V22H1V10Z", "chart": "M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z", "bell": "M10 21H14C14 22.1 13.1 23 12 23S10 22.1 10 21M21 19V20H3V19L5 17V11C5 7.9 7 5.2 10 4.3V4C10 2.9 10.9 2 12 2S14 2.9 14 4V4.3C17 5.2 19 7.9 19 11V17L21 19M17 11C17 8.2 14.8 6 12 6S7 8.2 7 11V18H17V11Z", "flag": "M14.4,6H20V16H13L12.6,14H7V21H5V4H14L14.4,6M14,14H16V12H18V10H16V8H14V10L13,8V6H11V8H9V6H7V8H9V10H7V12H9V10H11V12H13V10L14,12V14M11,10V8H13V10H11M14,10H16V12H14V10Z", "sun": "M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,2L14.39,5.42C13.65,5.15 12.84,5 12,5C11.16,5 10.35,5.15 9.61,5.42L12,2M3.34,7L7.5,6.65C6.9,7.16 6.36,7.78 5.94,8.5C5.5,9.24 5.25,10 5.11,10.79L3.34,7M3.36,17L5.12,13.23C5.26,14 5.53,14.78 5.95,15.5C6.37,16.24 6.91,16.86 7.5,17.37L3.36,17M20.65,7L18.88,10.79C18.74,10 18.47,9.23 18.05,8.5C17.63,7.78 17.1,7.15 16.5,6.64L20.65,7M20.64,17L16.5,17.36C17.09,16.85 17.62,16.22 18.04,15.5C18.46,14.77 18.73,14 18.87,13.21L20.64,17M12,22L9.59,18.56C10.33,18.83 11.14,19 12,19C12.82,19 13.63,18.83 14.37,18.56L12,22Z", "sleep": "M23,12H17V10L20.39,6H17V4H23V6L19.62,10H23V12M15,16H9V14L12.39,10H9V8H15V10L11.62,14H15V16M7,20H1V18L4.39,14H1V12H7V14L3.62,18H7V20Z"};
    const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
    const shape = (name, color, small) => `<span class="shape c-${color}${small ? ' sm' : ''}">${icon(name)}</span>`;
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Bounded, intuitive settings become Mushroom-style sliders. Precise
    // amounts and identifiers remain normal inputs.
    const RANGE_FIELDS = {
      soc: '%', default_soc: '%', min_choice: '%', min_soc: '%',
      force_minutes: ' min', ready_guard_margin_minutes: ' min', battery_care_soc: '%', battery_care_hours: ' h', forecast_factor: '×', max_soc: '%',
      grid_allow: ' W', delay_start_minutes: ' min', delay_stop_minutes: ' min',
      capacity_kwh: ' kWh', efficiency: '', charge_kw: ' kW', discharge_kw: ' kW',
      min_pct: '%', max_pct: '%', ev_from_pct: '%', ev_to_pct: '%',
      loss_percent: '%', stale_hours: ' h',
    };
    function rangeText(input) {
      const n = Number(input.value);
      if (input.name === 'efficiency' || input.name === 'forecast_factor') return `${Math.round(n * 100)}%`;
      return `${Number.isFinite(n) ? n : '–'}${input.dataset.unit || RANGE_FIELDS[input.name] || ''}`;
    }
    function refreshRangeValues(root = document) {
      root.querySelectorAll('input[data-mushroom-range]').forEach((input) => {
        const out = input.closest('.field') && input.closest('.field').querySelector('.range-value');
        if (out) out.textContent = rangeText(input);
        const min = Number(input.min);
        const max = Number(input.max);
        const value = Number(input.value);
        if (Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(value)) {
          input.style.setProperty('--range-pos', `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`);
        }
      });
    }
    function enhanceRangeControls(root = document) {
      root.querySelectorAll('input[type="number"]').forEach((input) => {
        if (!(input.name in RANGE_FIELDS) || !input.hasAttribute('min') || !input.hasAttribute('max')) return;
        input.type = 'range';
        input.dataset.mushroomRange = '1';
        const field = input.closest('.field');
        const label = field && field.querySelector('label');
        if (label && !label.querySelector('.range-value')) {
          const out = document.createElement('output');
          out.className = 'range-value';
          label.appendChild(out);
        }
      });
      refreshRangeValues(root);
    }
    document.addEventListener('input', (event) => {
      if (event.target.matches('input[data-mushroom-range]')) refreshRangeValues(event.target.closest('.field') || document);
    });
    document.addEventListener('change', (event) => {
      if (event.target.matches('input[data-mushroom-range]')) refreshRangeValues(event.target.closest('.field') || document);
    });

    // More chargers: every request is for the charger chosen in the bar.
    let multiCharger = false;
    let chargerSel = null;
    let chargerAdding = false;
    let chargerCars = [];
    let chargerOptionOn = false;

    async function api(method, url, body) {
      // Changes are always sent as JSON: the app refuses anything else.
      const write = method !== 'GET';
      if (multiCharger && chargerSel && !/[?&]charger=/.test(url)) url += `${url.includes('?') ? '&' : '?'}charger=${encodeURIComponent(chargerSel)}`;
      const res = await fetch(url, {
        method,
        headers: write ? { 'Content-Type': 'application/json' } : undefined,
        body: write ? JSON.stringify(body || {}) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    }

    // ---------------------------------------------------------------------
    // Section definitions. Each section finds a kind of device, lets the
    // user confirm its entities, and shows the saved choice with live values.
    // ---------------------------------------------------------------------
    const SECTIONS = {
      vehicle: {
        api: 'api/vehicles',
        listKey: 'vehicles',
        noun: 'vehicle',
        intro: 'The app searches Home Assistant for electric and plug-in hybrid vehicles.',
        fields: [
          { key: 'soc_entity', opt: 'soc', label: 'Battery (SoC)', required: true },
          { key: 'range_entity', opt: 'range', label: 'Range' },
          { key: 'charging_entity', opt: 'charging', label: 'Charging' },
          { key: 'plugged_entity', opt: 'plugged', label: 'Plugged in' },
          { key: 'charge_limit_entity', opt: 'charge_limit', label: "Car's own charge limit (e.g. Target charge level)" },
        ],
        extraInputs: () => `
          ${multiCar ? `<div class="field"><label>Name in the calendar (optional)</label>
            <input name="calendar_name" maxlength="30" placeholder="e.g. renault">
            <div class="muted small">A calendar event with "auto: renault" or "car: renault" is then only for this car. The car's name and its brand (when no other car has it) also work.</div></div>` : ''}
          <div class="two">
            <div class="field"><label>Battery capacity in kWh (needed to estimate the level when the car cannot be reached)</label>
              <input name="capacity_kwh" type="number" min="1" max="300" step="0.1" placeholder="e.g. 60"></div>
            <div class="field"><label>Car data counts as old after (hours)</label>
              <input name="stale_hours" type="number" min="0.5" max="48" step="0.5" value="3"></div>
          </div>
          <div class="field"><label>Use per 100 km in kWh (optional, for trip estimates)</label>
            <input name="consumption_kwh_100km" type="number" min="8" max="40" step="0.5" placeholder="18">
            <div class="muted small">For how much battery a trip in your calendar costs. The app learns this from your own trips (battery level when you leave and when you are back); until then it uses the car's range sensor, or this value.</div></div>
          <p class="muted small">When the car's cloud is down (battery level unavailable or not read for that long), the app goes on with the last level plus what the charger delivered since, and does not change the car's charge limit until the car is back.</p>`,
        extraRows: (v) => [
          ['Battery level from', { sensor: 'the car (sensor)', manual_soc: 'entered by you at plug-in', fixed_kwh: `fixed amount: ${esc(v.fixed_kwh)} kWh per session` }[v.mode || 'sensor']],
          ['Battery capacity', v.capacity_kwh ? `${esc(v.capacity_kwh)} kWh` : null],
          ['Car data old after', (v.mode || 'sensor') === 'sensor' ? `${esc(v.stale_hours ?? 3)} hours` : null],
        ],
        manual: (data) => ({
          intro: 'Pick any sensor that shows the battery level in %.',
          options: { soc: data.percent_sensors },
        }),
      },
      charger: {
        api: 'api/chargers',
        listKey: 'chargers',
        noun: 'charger',
        intro: 'The app searches Home Assistant for EV chargers. Nothing is controlled yet; this only checks what your charger offers.',
        fields: [
          { key: 'status_entity', opt: 'status', label: 'Status' },
          { key: 'power_entity', opt: 'power', label: 'Charging power', others: 'power' },
          { key: 'current_entity', opt: 'current', label: 'Charging current setting (A)' },
          { key: 'switch_entity', opt: 'switch', label: 'Start/stop switch' },
        ],
        candidateNote: (c) => c.needs_actions
          ? 'This charger has no current setting or switch in Home Assistant. Control will go through its actions (services); that is added in a later version.'
          : '',
        extraInputs: (c) => {
          const limits = (c && c.limits) || [];
          const follow = (c && c.suggested_max_entities) || [];
          const KIND = { max_charger: 'charger maximum', max_circuit: 'circuit maximum', dynamic_charger: 'live charger limit', dynamic_circuit: 'live circuit limit', output: 'output limit' };
          const enabled = limits.filter((l) => !l.disabled);
          const disabled = limits.filter((l) => l.disabled && ['max_charger', 'max_circuit'].includes(l.kind));
          const limitList = enabled.length ? `<div class="small muted">Limits found: ${enabled.map((l) => `${esc(l.name)} = ${esc(tidy(l.state))} A <span class="src">(${esc(KIND[l.kind])})</span>`).join(' · ')}</div>` : '';
          const disabledNote = disabled.length
            ? `<div class="note">This charger also has ${disabled.map((l) => `<strong>${esc(l.name)}</strong> (<code>${esc(l.entity_id)}</code>)`).join(' and ')}, but ${disabled.length > 1 ? 'they are' : 'it is'} disabled in Home Assistant. Enable ${disabled.length > 1 ? 'them' : 'it'} under Settings → Devices & services → Entities, then detect again, and the app will read the maximum current by itself.</div>`
            : '';
          return `
          <div class="two">
            <div class="field"><label>Phases</label>
              <select name="phases"><option value="3">3 phases</option><option value="1">1 phase</option></select></div>
            <div class="field"><label>Maximum current in A${follow.length ? '' : ' (optional)'}</label>
              <input name="max_current" type="number" min="6" max="80" step="1" value="${follow.length ? '' : ''}" placeholder="${c && c.suggested_max_current ? esc(c.suggested_max_current) : 'e.g. 16'}"></div>
          </div>
          ${follow.length ? `<label class="check"><input type="checkbox" name="follow_limits" checked> Follow the charger's own limit (now ${esc(c.suggested_max_current)} A) live</label>
            <input type="hidden" name="max_current_entities" value="${esc(follow.join(','))}">` : ''}
          ${limitList}${disabledNote}
          ${chargerOptionOn && chargerCars.length > 1 ? `<div class="field"><label>Usual car on this charger</label>
            <select name="vehicle_id"><option value="">— any —</option>${chargerCars.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select>
            <div class="muted small">When this car says it is plugged in, it is on this charger; the app still notices when the cars are the other way round.</div></div>` : ''}`;
        },
        extraRows: (c) => [
          ['Phases', String(c.phases)],
          ['Maximum current', c.live && c.live.max && c.live.max.amps
            ? `${esc(tidy(c.live.max.amps))} A<div class="muted small">${c.live.max.source === 'manual' ? 'set manually' : `live from ${esc(c.live.max.source)}`}</div>`
            : null],
        ],
        afterSaved: () => `
          <div class="card" id="control-check">
            <h2>Control check</h2>
            <p class="muted small">Finds out how this charger could be controlled: which actions and entities the app would use for start/stop and for the charging current. Nothing is sent to the charger.</p>
            <div class="buttons"><button class="secondary" id="control-check-btn">Check control options</button></div>
            <div id="control-result"></div>
          </div>`,
        manual: (data) => ({
          intro: 'Pick the entities of your charger yourself. Choose at least one.',
          options: data.manual,
        }),
      },
      grid: {
        api: 'api/grid',
        listKey: 'grid',
        noun: 'grid meter',
        intro: 'The app looks for the meter that measures your home\'s connection to the grid (P1 meter, smart meter reader, load balancer), and for an existing load balancer.',
        fields: [
          { key: 'net_entity', opt: 'net', label: 'Net power (import minus export)' },
          { key: 'import_entity', opt: 'import', label: 'Import power (only if there is no net power)' },
          { key: 'export_entity', opt: 'export', label: 'Export power (only if there is no net power)' },
          { key: 'current_l1_entity', opt: 'current_l1', label: 'Current phase L1 (A)' },
          { key: 'current_l2_entity', opt: 'current_l2', label: 'Current phase L2 (A)' },
          { key: 'current_l3_entity', opt: 'current_l3', label: 'Current phase L3 (A)' },
        ],
        candidateNote: (c) => c.kind === 'load_balancer'
          ? 'This is a load balancer that also measures your grid connection. You can use it as grid meter, but a P1 meter is usually more accurate.'
          : '',
        extraInputs: (c, data) => {
          const lbs = (data && data.load_balancers) || [];
          const lbOpts = lbs.map((lb, i) =>
            `<option value="${esc(lb.device_id)}" data-name="${esc(lb.name)}" ${i === 0 && !lb.offline ? 'selected' : ''}>${esc(lb.name)}${lb.model ? ' (' + esc(lb.model) + ')' : ''}${lb.offline ? ' – offline' : ''}</option>`).join('');
          return `
          <div class="two">
            <div class="field"><label>Main fuse in A – required</label>
              <input name="main_fuse" type="number" min="6" max="200" step="1" value="25" required></div>
            <div class="field"><label>Phases</label>
              <select name="phases"><option value="3">3 phases</option><option value="1">1 phase</option></select></div>
          </div>
          <div class="field"><label>Load balancing</label>
            <select name="load_balancer">
              ${lbOpts}
              <option value="" data-name="">No load balancer</option>
              <option value="other" data-name="">Built into the charger, or not in Home Assistant</option>
            </select></div>
          <div class="note">With a load balancer, the main fuse is already protected and the app will work within its limits. Without one, the app will watch the main fuse itself using the grid meter.</div>`;
        },
        extraRows: (g) => [
          ['Main fuse', `${esc(g.main_fuse)} A`],
          ['Phases', String(g.phases)],
          ['Load balancing', g.load_balancer ? esc(g.load_balancer.name) : 'None'],
        ],
        manual: (data) => ({
          intro: 'Pick your grid power sensor yourself: a net power sensor, or import and export sensors.',
          options: data.manual,
        }),
      },
    };

    const lastDetect = {};

    // ---------- Rendering helpers ----------
    function optionLabel(o) {
      const val = o.unit ? `${tidy(o.state)} ${o.unit}` : tidy(o.state);
      return `${esc(o.name)} (${esc(val)})`;
    }

    function selectField(f, options, selected, others = []) {
      const own = new Set(options.map((o) => o.entity_id));
      const extra = others.filter((o) => !own.has(o.entity_id));
      let control;
      if (!options.length && !extra.length) {
        control = f.required
          ? '<div class="error small">None found.</div>'
          : '<div class="muted small">None found.</div>';
      } else {
        const toOpts = (list) => list.map((o) =>
          `<option value="${esc(o.entity_id)}" ${o.entity_id === selected ? 'selected' : ''}>${optionLabel(o)}</option>`).join('');
        const main = extra.length && options.length
          ? `<optgroup label="This device">${toOpts(options)}</optgroup>` : toOpts(options);
        const other = extra.length ? `<optgroup label="Other devices">${toOpts(extra)}</optgroup>` : '';
        control = `<select name="${f.key}">${f.required ? '' : '<option value="">— none —</option>'}${main}${other}</select>`;
      }
      return `<div class="field" data-key="${f.key}"><label>${esc(f.label)}${f.required ? ' – required' : ''}</label>${control}</div>`;
    }

    // Round long numbers from sensors: 9.15299987792969 -> 9.15
    function tidy(state) {
      const n = Number(state);
      if (state === '' || state == null || !Number.isFinite(n)) return String(state ?? '');
      const d = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
      return String(Number(n.toFixed(d)));
    }

    function fmt(v) {
      if (!v) return '<span class="muted">not set</span>';
      const val = v.unit ? `${esc(tidy(v.state))} ${esc(v.unit)}` : esc(tidy(v.state));
      return `${val}<div class="muted small">${esc(v.entity_id)}</div>`;
    }

    function canSubmit(cfg, options) {
      const required = cfg.fields.filter((f) => f.required);
      if (required.length) return required.every((f) => (options[f.opt] || []).length);
      return cfg.fields.some((f) => (options[f.opt] || []).length);
    }

    function candidateCard(kind, c, i, data) {
      const cfg = SECTIONS[kind];
      const how = c.detected_by === 'known_integration' ? 'Known integration' : 'Recognised by its entities';
      const make = [c.manufacturer, c.model].filter(Boolean).join(' ');
      const notes = [];
      if (c.offline) notes.push(`This ${cfg.noun} is not reporting any data. It may be an old device that is still in Home Assistant.`);
      if (cfg.candidateNote && cfg.candidateNote(c)) notes.push(cfg.candidateNote(c));
      const others = (f) => (f.others && data.manual ? data.manual[f.others] || [] : []);
      return `
        <form class="card" data-kind="${kind}" data-index="${i}">
          <h2>${esc(c.name)}</h2>
          <p>${c.offline ? '<span class="chip offline">Offline</span>' : ''}<span class="chip">${esc(c.integration)}</span><span class="chip">${esc(how)}</span>
            ${make ? `<span class="muted small">${esc(make)}</span>` : ''}</p>
          ${cfg.fields.map((f) => selectField(f, c.options[f.opt] || [], c.suggested[f.opt], others(f))).join('')}
          ${notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}
          ${cfg.extraInputs(c, data)}
          <div class="buttons"><button class="primary" type="submit" ${canSubmit(cfg, c.options) ? '' : 'disabled'}>Use this ${cfg.noun}</button></div>
          <div class="error form-error" hidden></div>
        </form>`;
    }

    function manualCard(kind, data) {
      const cfg = SECTIONS[kind];
      const m = cfg.manual(data);
      return `
        <form class="card" data-kind="${kind}" data-index="manual">
          <p class="muted">${esc(m.intro)}</p>
          <div class="field"><label>Name</label><input name="name" placeholder="My ${cfg.noun}"></div>
          ${cfg.fields.map((f) => selectField(f, m.options[f.opt] || [], null)).join('')}
          ${cfg.extraInputs(null, data)}
          <div class="buttons"><button class="primary" type="submit" ${canSubmit(cfg, m.options) ? '' : 'disabled'}>Save</button></div>
          <div class="error form-error" hidden></div>
        </form>`;
    }

    // ---------- Car without integration ----------
    function noIntegrationCard() {
      return `
        <form class="card" id="noint-form">
          <h2>No car integration?</h2>
          <p class="muted small">The app can still plan. It follows plugging in and out through the charger, and counts the energy charged with the charger's power sensor (Charger tab).</p>
          <div class="field"><label>Name</label><input name="name" placeholder="My vehicle"></div>
          <label class="check"><input type="radio" name="mode" value="manual_soc" checked> I enter the battery level myself when I plug in</label>
          <label class="check"><input type="radio" name="mode" value="fixed_kwh"> Charge a fixed amount each time</label>
          <div class="two">
            <div class="field" id="noint-capacity"><label>Battery capacity in kWh</label><input name="capacity_kwh" type="number" min="1" max="300" step="0.1" placeholder="e.g. 60"></div>
            <div class="field" id="noint-fixed" hidden><label>Amount per session in kWh</label><input name="fixed_kwh" type="number" min="1" max="150" step="0.5" placeholder="e.g. 20"></div>
          </div>
          <div class="buttons"><button class="primary" type="submit">Use this</button></div>
          <div class="error form-error" hidden></div>
        </form>`;
    }

    function wireNoIntegration() {
      const f = $('noint-form');
      f.addEventListener('change', () => {
        const fixed = f.mode.value === 'fixed_kwh';
        $('noint-fixed').hidden = !fixed;
        $('noint-capacity').querySelector('label').textContent = fixed ? 'Battery capacity in kWh (optional)' : 'Battery capacity in kWh';
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = f.querySelector('.form-error');
        errBox.hidden = true;
        try {
          const r = await api('POST', 'api/vehicles', {
            mode: f.mode.value, name: f.name.value || 'My vehicle',
            capacity_kwh: f.capacity_kwh.value, fixed_kwh: f.fixed_kwh.value,
            ...vehicleTarget(),
          });
          if (r.vehicle) { vehicleAdding = false; vehicleSel = r.vehicle.id; }
          formFilled.vehicle = false;
          $('vehicle-results').innerHTML = '';
          loadSaved('vehicle');
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        }
      });
    }

    // ---------- More than one car (an option, off by default) ----------
    let multiCar = false;
    let vehicleSel = null; // id of the car shown in Settings › Vehicle
    let vehicleAdding = false; // "Add a car" pressed: the forms are for a new car

    function vehicleTarget() {
      return vehicleAdding ? { add: true } : (vehicleSel ? { id: vehicleSel } : {});
    }

    function multiCarCard(data) {
      const box = $('vehicle-multi');
      if (!box) return;
      const list = data.vehicles || [];
      if (!list.length) { box.innerHTML = ''; return; }
      const unused = list.filter((v) => !v.used);
      const chips = multiCar ? `
        <div class="buttons car-picker">
          ${list.map((v) => `<button type="button" class="${!vehicleAdding && v.id === vehicleSel ? 'primary' : 'secondary'}" data-car="${esc(v.id)}">${icon('car')}<span>${esc(v.name)}</span></button>`).join('')}
          ${list.length < (data.max_vehicles || 6) ? `<button type="button" class="${vehicleAdding ? 'primary' : 'secondary'}" data-car-add>+ Add a car</button>` : ''}
        </div>
        ${list.length > 1 ? `<p class="muted small">The app recognises the connected car by each car's <strong>Plugged in</strong> sensor. A car without one is recognised when no other car says it is plugged in. When the app is not sure, Home asks you which car is connected.</p>` : '<p class="muted small">Add your other car with <strong>+ Add a car</strong>.</p>'}` : '';
      box.innerHTML = `
        <div class="card">
          <label class="check"><input type="checkbox" id="multi-car" ${multiCar ? 'checked' : ''}> I have more than one car</label>
          <p class="muted small">For more than one car on this charger: the app recognises which car is connected and plans for that car. Leave it off with one car.</p>
          ${!multiCar && unused.length ? `<p class="muted small">${unused.length} other car${unused.length > 1 ? 's are' : ' is'} saved but not used while this is off.</p>` : ''}
          ${chips}
        </div>`;
      $('multi-car').onchange = async (e) => {
        try {
          await api('POST', 'api/vehicles/multi', { enabled: e.target.checked });
        } catch (err) {
          e.target.checked = !e.target.checked;
          alert(err.message);
          return;
        }
        vehicleAdding = false;
        loadSaved('vehicle');
      };
      box.querySelectorAll('[data-car]').forEach((b) => {
        b.onclick = () => {
          vehicleAdding = false;
          vehicleSel = b.dataset.car;
          formFilled.vehicle = false;
          $('vehicle-results').innerHTML = '';
          loadSaved('vehicle');
        };
      });
      const add = box.querySelector('[data-car-add]');
      if (add) add.onclick = () => {
        vehicleAdding = true;
        formFilled.vehicle = false;
        $('vehicle-results').innerHTML = '';
        const f = $('noint-form');
        if (f) f.reset();
        loadSaved('vehicle');
      };
    }

    // ---------- More than one charger (an option, off by default) ----------
    function multiChargerCard(data, on) {
      const box = $('charger-multi');
      if (!box) return;
      const list = data.chargers || [];
      if (!list.length) { box.innerHTML = ''; return; }
      const unused = list.filter((c) => !c.used);
      box.innerHTML = `
        <div class="card">
          <label class="check"><input type="checkbox" id="multi-charger" ${on ? 'checked' : ''}> I have more than one charger</label>
          <p class="muted small">For more than one charger at home: every charger gets its own plan and control. When the connection is too small for all of them, the car with the least room to spare goes first (it leaves soonest for what it still needs) and the rest is shared. Leave it off with one charger.</p>
          ${!on && unused.length ? `<p class="muted small">${unused.length} other charger${unused.length > 1 ? 's are' : ' is'} saved but not used while this is off.</p>` : ''}
          ${on ? `<div class="buttons car-picker">
            ${list.map((c) => `<button type="button" class="${!chargerAdding && c.id === chargerSel ? 'primary' : 'secondary'}" data-charger="${esc(c.id)}">${icon('charger')}<span>${esc(c.name)}</span></button>`).join('')}
            ${list.length < (data.max_chargers || 4) ? `<button type="button" class="${chargerAdding ? 'primary' : 'secondary'}" data-charger-add>+ Add a charger</button>` : ''}
          </div>
          <p class="muted small">The charger you choose here (or in the bar at the top) is the one Home, Plan, Rules and Activity show.</p>` : ''}
        </div>`;
      $('multi-charger').onchange = async (e) => {
        try {
          await api('POST', 'api/chargers/multi', { enabled: e.target.checked });
        } catch (err) {
          e.target.checked = !e.target.checked;
          alert(err.message);
          return;
        }
        chargerAdding = false;
        await loadChargerBar();
        loadSaved('charger');
      };
      box.querySelectorAll('[data-charger]').forEach((b) => {
        b.onclick = () => selectCharger(b.dataset.charger);
      });
      const add = box.querySelector('[data-charger-add]');
      if (add) add.onclick = () => {
        chargerAdding = true;
        formFilled.charger = false;
        $('charger-results').innerHTML = '';
        loadSaved('charger');
      };
    }

    // The bar at the top: which charger the pages show.
    async function loadChargerBar() {
      const bar = $('charger-bar');
      try {
        const d = await api('GET', 'api/chargers?charger=');
        chargerCars = d.cars || [];
        const used = (d.chargers || []).filter((c) => c.used);
        multiCharger = !!d.multi_charger && used.length > 1;
        if (!used.some((c) => c.id === chargerSel)) chargerSel = used.length ? used[0].id : null;
        if (!multiCharger) { bar.hidden = true; bar.innerHTML = ''; return; }
        bar.hidden = false;
        bar.innerHTML = used.map((c) => `<button type="button" class="charger-chip${c.id === chargerSel ? ' active' : ''}" data-bar="${esc(c.id)}">${icon('charger')}<span>${esc(c.name)}</span></button>`).join('');
        bar.querySelectorAll('[data-bar]').forEach((b) => { b.onclick = () => selectCharger(b.dataset.bar); });
      } catch {
        bar.hidden = true;
      }
    }

    function selectCharger(id) {
      chargerAdding = false;
      chargerSel = id;
      formFilled.charger = false;
      if ($('charger-results')) $('charger-results').innerHTML = '';
      document.querySelectorAll('#charger-bar [data-bar]').forEach((b) => b.classList.toggle('active', b.dataset.bar === id));
      for (const k of Object.keys(SECTIONS)) formFilled[k] = false;
      loadSaved('charger');
      showTab(currentShow);
    }

    // ---------- Section flow ----------
    function sectionShell(kind) {
      const cfg = SECTIONS[kind];
      $('tab-' + kind).innerHTML = `
        ${kind === 'vehicle' ? '<div id="vehicle-multi"></div>' : ''}${kind === 'charger' ? '<div id="charger-multi"></div>' : ''}
        <div class="card" id="${kind}-intro">
          <h2>Find your ${cfg.noun}</h2>
          <p class="muted">${esc(cfg.intro)}</p>
          <div class="buttons"><button class="primary" id="${kind}-detect">Detect ${cfg.noun}s</button></div>
          <div id="${kind}-error" class="error" hidden></div>
        </div>
        ${kind === 'vehicle' ? noIntegrationCard() : ''}
        <div id="${kind}-results"></div>
        <div id="${kind}-saved"></div>
        <div id="${kind}-extra"></div>`;
      $(`${kind}-detect`).addEventListener('click', () => detect(kind));
      if (kind === 'vehicle') wireNoIntegration();
    }

    // Forms already filled with the saved settings, per section.
    const formFilled = {};
    const savedItems = {};

    async function loadSaved(kind) {
      const cfg = SECTIONS[kind];
      const box = $(`${kind}-saved`);
      try {
        const data = await api('GET', cfg.api);
        let list = data[cfg.listKey];
        if (kind === 'vehicle') {
          multiCar = !!data.multi_car;
          if (!multiCar) vehicleAdding = false;
          if (list.length && !list.some((v) => v.id === vehicleSel)) vehicleSel = list[0].id;
          if (!multiCar && list.length) vehicleSel = list[0].id;
          multiCarCard(data);
          if (vehicleAdding) {
            $(`${kind}-intro`).querySelector('h2').textContent = 'Add a car';
            list = [];
          } else {
            $(`${kind}-intro`).querySelector('h2').textContent = `Find your ${cfg.noun}`;
            list = list.filter((v) => v.id === vehicleSel);
          }
        }
        if (kind === 'charger') {
          if (data.cars) chargerCars = data.cars;
          const on = !!data.multi_charger;
          chargerOptionOn = on;
          if (!on) chargerAdding = false;
          multiCharger = on && list.filter((c) => c.used).length > 1;
          if (list.length && !list.some((c) => c.id === chargerSel && c.used)) chargerSel = (list.find((c) => c.used) || list[0]).id;
          multiChargerCard({ ...data, chargers: list }, on);
          if (chargerAdding) {
            $(`${kind}-intro`).querySelector('h2').textContent = 'Add a charger';
            list = [];
          } else {
            $(`${kind}-intro`).querySelector('h2').textContent = `Find your ${cfg.noun}`;
            list = list.filter((c) => c.id === chargerSel);
          }
        }
        if (!list.length) {
          box.innerHTML = '';
          formFilled[kind] = false;
          $(`${kind}-intro`).hidden = false;
          if ($('noint-form') && kind === 'vehicle') $('noint-form').hidden = false;
          return;
        }
        const item = list[0];
        $(`${kind}-intro`).hidden = true;
        if ($('noint-form') && kind === 'vehicle') $('noint-form').hidden = true;
        const liveRows = cfg.fields.map((f) =>
          `<div class="row"><span class="label">${esc(f.label)}</span><span class="value">${fmt(item.live[f.opt])}</span></div>`).join('');
        const extra = cfg.extraRows(item).map(([label, val]) =>
          `<div class="row"><span class="label">${esc(label)}</span><span class="value">${val ?? '<span class="muted">not set</span>'}</span></div>`).join('');
        box.innerHTML = `
          <div class="card">
            <h2>Now · ${esc(item.name)}</h2>
            <p class="muted small">${item.integration ? 'Integration: ' + esc(item.integration) : 'Chosen manually'}</p>
            ${liveRows}${extra}
            <div class="buttons">
              <button class="secondary" data-act="remove">Remove ${esc(cfg.noun)} settings</button>
            </div>
          </div>`;
        if (cfg.afterSaved) {
          box.insertAdjacentHTML('beforeend', cfg.afterSaved(item));
          const btn = box.querySelector('#control-check-btn');
          if (btn) btn.onclick = runControlCheck;
        }
        // The settings are shown as a form right away, filled with what is saved.
        savedItems[kind] = item;
        if (!formFilled[kind]) {
          formFilled[kind] = true;
          if ($('noint-form') && kind === 'vehicle') $('noint-form').hidden = !(item.mode && item.mode !== 'sensor');
          await detect(kind, item);
        }
        box.querySelector('[data-act=remove]').onclick = async () => {
          if (!confirm(`Remove this ${cfg.noun} from the app?`)) return;
          await api('DELETE', (kind === 'vehicle' || kind === 'charger') && item.id ? `${cfg.api}?id=${encodeURIComponent(item.id)}` : cfg.api);
          if (kind === 'vehicle') vehicleSel = null;
          if (kind === 'charger') { chargerSel = null; await loadChargerBar(); }
          $(`${kind}-results`).innerHTML = '';
          formFilled[kind] = false;
          savedItems[kind] = null;
          loadSaved(kind);
        };
      } catch (err) {
        box.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    // "Change": fill the forms with what is saved now, so nothing has to be
    // entered again. Nothing is saved until you press the save button.
    function setValue(form, name, value) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el || value == null || value === '') return;
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(value))) {
        el.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)} (saved)</option>`);
      }
      el.value = String(value);
    }

    function prefill(kind, saved) {
      const cfg = SECTIONS[kind];
      const box = $(`${kind}-results`);
      if (kind === 'vehicle' && saved.mode && saved.mode !== 'sensor') {
        const f = $('noint-form');
        if (!f) return;
        f.querySelector(`input[name=mode][value="${saved.mode}"]`).checked = true;
        setValue(f, 'name', saved.name);
        setValue(f, 'capacity_kwh', saved.capacity_kwh);
        setValue(f, 'fixed_kwh', saved.fixed_kwh);
        f.dispatchEvent(new Event('change'));
        return;
      }
      const cands = (lastDetect[kind] && lastDetect[kind].candidates) || [];
      const idx = saved.device_id ? cands.findIndex((c) => c.device_id === saved.device_id) : -1;
      let form = idx >= 0 ? box.querySelector(`form[data-index="${idx}"]`) : null;
      if (!form) {
        form = box.querySelector('form[data-index="manual"]');
        if (!form) return;
        form.closest('details').open = true;
        setValue(form, 'name', saved.name);
      }
      for (const f of cfg.fields) {
        const el = form.querySelector(`[name="${f.key}"]`);
        if (el) el.value = '';
        else if (saved[f.key]) {
          // Not found now; keep the saved entity as a choice.
          const html = `<label>${esc(f.label)}</label><select name="${f.key}"><option value="">— none —</option></select>`;
          const div = form.querySelector(`.field[data-key="${f.key}"]`);
          if (div) div.innerHTML = html;
          else form.querySelector('.buttons').insertAdjacentHTML('beforebegin', `<div class="field">${html}</div>`);
        }
        setValue(form, f.key, saved[f.key]);
      }
      for (const name of ['capacity_kwh', 'phases', 'max_current', 'main_fuse', 'stale_hours', 'calendar_name', 'vehicle_id', 'consumption_kwh_100km']) setValue(form, name, saved[name]);
      const follow = form.querySelector('input[name=follow_limits]');
      if (follow) follow.checked = (saved.max_current_entities || []).length > 0;
      if (kind === 'grid') {
        const lb = saved.load_balancer;
        setValue(form, 'load_balancer', lb ? (lb.type === 'other' ? 'other' : lb.device_id) : '');
        if (!lb) form.querySelector('select[name=load_balancer]').value = '';
      }
      form.dataset.mine = '1';
      const btn = form.querySelector('button[type=submit]');
      if (btn) btn.textContent = 'Save';
    }

    // With saved settings: show only the form with them; other devices and
    // choosing manually go under "Use a different …".
    function tidySavedForm(kind) {
      const cfg = SECTIONS[kind];
      const box = $(`${kind}-results`);
      const mine = box.querySelector('form[data-mine]') || (box.querySelector('details form[data-mine]'));
      const header = box.querySelector(':scope > p, :scope > .card:not(form):not(details)');
      if (header) header.remove();
      const others = [...box.children].filter((el) => el !== mine && !(mine && el.contains(mine)));
      const wrap = document.createElement('details');
      wrap.className = 'card';
      wrap.innerHTML = `<summary>Use a different ${esc(cfg.noun)} or choose the entities yourself</summary>`;
      others.forEach((el) => {
        if (el.tagName === 'DETAILS') { el.open = true; el.classList.remove('card'); el.querySelector('summary') && el.querySelector('summary').remove(); }
        wrap.appendChild(el);
      });
      if (mine && mine.closest('details')) {
        // The saved settings were chosen manually: keep that form visible.
        const d = mine.closest('details');
        box.insertBefore(mine, box.firstChild);
        if (!d.querySelector('form')) d.remove();
      }
      box.insertAdjacentHTML('afterbegin', `<h2 class="section-title">Settings</h2>`);
      if (wrap.children.length > 1) box.appendChild(wrap);
      box.insertAdjacentHTML('beforeend', `<div class="buttons"><button class="secondary" type="button" data-act="redetect">Search again</button></div>`);
      box.querySelector('[data-act=redetect]').onclick = () => detect(kind, savedItems[kind]);
    }

    async function detect(kind, saved) {
      const cfg = SECTIONS[kind];
      const btn = $(`${kind}-detect`);
      btn.disabled = true;
      btn.textContent = 'Searching…';
      $(`${kind}-error`).hidden = true;
      try {
        const data = await api('GET', `${cfg.api}/detect`);
        lastDetect[kind] = data;
        const n = data.candidates.length;
        const header = n
          ? `<p class="muted">${n} ${cfg.noun}${n > 1 ? 's' : ''} found. Check the suggested entities and choose one.</p>`
          : `<div class="card"><h2>No ${cfg.noun} found</h2><p class="muted">Nothing recognisable was found. You can choose the entities yourself below.</p></div>`;
        $(`${kind}-results`).innerHTML = header +
          data.candidates.map((c, i) => candidateCard(kind, c, i, data)).join('') +
          `<details class="card" ${n ? '' : 'open'}><summary>Not listed? Choose manually</summary>${manualCard(kind, data)}</details>`;
        $(`${kind}-results`).querySelectorAll('form').forEach((f) => f.addEventListener('submit', save));
        if (saved) {
          $(`${kind}-intro`).hidden = true;
          prefill(kind, saved);
          tidySavedForm(kind);
        }
      } catch (err) {
        $(`${kind}-error`).textContent = err.message;
        $(`${kind}-error`).hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Detect again';
      }
    }

    async function save(e) {
      e.preventDefault();
      const form = e.target;
      const kind = form.dataset.kind;
      const cfg = SECTIONS[kind];
      const data = Object.fromEntries(new FormData(form));
      if ('follow_limits' in data || form.querySelector('input[name=follow_limits]')) {
        if (!form.querySelector('input[name=follow_limits]').checked) data.max_current_entities = '';
        delete data.follow_limits;
      }
      const lbSelect = form.querySelector('select[name=load_balancer]');
      if (lbSelect) data.load_balancer_name = lbSelect.selectedOptions[0].dataset.name || '';
      if (form.dataset.index !== 'manual') {
        const c = lastDetect[kind].candidates[Number(form.dataset.index)];
        data.name = c.name;
        data.device_id = c.device_id;
        data.integration = c.integration;
      }
      const errBox = form.querySelector('.form-error');
      if (kind === 'vehicle') Object.assign(data, vehicleTarget());
      if (kind === 'charger') Object.assign(data, chargerAdding ? { add: true } : (chargerSel ? { id: chargerSel } : {}));
      try {
        const r = await api('POST', cfg.api, data);
        if (kind === 'vehicle' && r.vehicle) { vehicleAdding = false; vehicleSel = r.vehicle.id; }
        if (kind === 'charger' && r.charger) { chargerAdding = false; chargerSel = r.charger.id; await loadChargerBar(); }
        formFilled[kind] = false;
        await loadSaved(kind);
        const okBtn = $(`${kind}-results`).querySelector('form[data-mine] button[type=submit]');
        if (okBtn) { okBtn.insertAdjacentHTML('afterend', ' <span class="ok small">Saved.</span>'); }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    }

    // ---------- Overview ----------
    let lastPlan = null;

    const NOTE_TEXT = {
      missing_data: 'The battery level or battery capacity is missing. Set the capacity in Settings › Vehicle.',
      already_at_target: 'The battery is already at or above the target. No charging needed.',
      prices_incomplete: 'Prices are not known all the way to the deadline yet. The plan uses the known prices and updates when new prices are published (usually around 13:00).',
      not_enough_known_time: 'Not enough known price blocks before the deadline to reach the target yet.',
      not_enough_time: 'Not enough time before the deadline to reach the target. The plan charges in every available block.',
      enter_soc: 'Enter the current battery level above to get a plan.',
      fixed_waiting: 'Waiting for the car to be plugged in. The plan starts when charging a new session.',
      no_departure: 'No departure planned. The plan uses the cheapest known blocks and the default battery level, without a deadline.',
      calendar_error: 'The calendar could not be read; other departure sources are still used.',
      uses_forecast: 'Part of the plan is in hours with only a forecast price (striped bars). The app never charges on a forecast: the plan is recalculated as soon as the real prices are published (usually around 13:00 for the next day). Forecast prices include the safety margin set in Settings › Prices.',
      forecast_error: 'The price forecast could not be read; the plan uses the real prices only.',
      solar_only: 'Solar only: the plan only uses the expected solar surplus, nothing from the grid. Charge now, the minimum battery level and preconditioning still work. Change this under Quick choices.',
      solar_forecast_error: 'The solar forecast could not be read; the plan counts on no sun. Charging on surplus still works.',
      minimum_not_reached: 'The minimum cannot be reached before the departure in between with the known prices and time. The plan charges as much as fits.',
    };

    function tzFmt(ms, opts) {
      // Before the first plan (setup wizard, Settings opened first) the browser's time zone is used.
      const tz = (lastPlan && lastPlan.time_zone) || undefined;
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(ms));
    }
    const hm = (ms) => tzFmt(ms, { hour: '2-digit', minute: '2-digit' });
    const dayHm = (ms) => tzFmt(ms, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const money = (v) => {
      if (v == null) return '–';
      try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: lastPlan.currency || 'EUR' }).format(v);
      } catch {
        return Number(v).toFixed(2);
      }
    };

    function niceTicks(min, max, count = 4) {
      const span = max - min || 1;
      const raw = span / count;
      const mag = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
      const ticks = [];
      const top = Math.ceil(max / step) * step;
      for (let v = Math.floor(min / step) * step; v <= top + step * 0.001; v += step) ticks.push(+v.toFixed(6));
      return ticks;
    }

    function drawChart(d) {
      const wrap = $('chart');
      if (!wrap || !d.prices.length) return;
      const W = Math.max(320, wrap.clientWidth);
      const H = 272;
      // Three dedicated marker lanes prevent "now", "safe start" and
      // "ready by" from colliding when they are only minutes apart.
      const m = { l: 44, r: 8, t: 46, b: 28 };
      const iw = W - m.l - m.r;
      const ih = H - m.t - m.b;
      const t0 = d.prices[0].start;
      const t1 = d.prices[d.prices.length - 1].end;
      const X = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
      const vals = d.prices.map((p) => p.total);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
      const y0v = ticks[0];
      const y1v = ticks[ticks.length - 1];
      const Y = (v) => m.t + ih - ((v - y0v) / (y1v - y0v)) * ih;
      const planned = new Set(d.plan.blocks.map((b) => (d.prices.find((p) => p.start <= b.start && b.start < p.end) || {}).start));
      // Expected charging after the next trip (orange; not steered).
      const expBlocks = d.next && d.next.expected ? d.next.expected.blocks : [];
      const expected = new Set(expBlocks.map((b) => (d.prices.find((p) => p.start <= b.start && b.start < p.end) || {}).start));

      // Bar width per block: real prices can be per 15 minutes, a forecast per hour.
      let bars = '';
      d.prices.forEach((p, i) => {
        const slot = X(p.end) - X(p.start);
        const gap = slot > 4 ? 2 : slot > 2 ? 1 : 0;
        const bw = Math.max(0.5, Math.min(24, slot - gap));
        const x = X(p.start) + (slot - bw) / 2;
        const top = Math.min(Y(p.total), Y(0));
        const h = Math.max(1, Math.abs(Y(p.total) - Y(0)));
        const isPlanned = planned.has(p.start);
        // Forecast prices are striped, so they differ from the (faded) past.
        const blk = isPlanned ? d.plan.blocks.find((b) => p.start <= b.start && b.start < p.end) : null;
        const onSolar = blk && blk.solar_kwh > blk.kwh / 2;
        const planColor = onSolar ? 'var(--solar)' : 'var(--accent)';
        const isExp = !isPlanned && expected.has(p.start);
        const fill = p.forecast
          ? (isPlanned ? (onSolar ? 'url(#fc-sol)' : 'url(#fc-plan)') : isExp ? 'url(#fc-exp)' : 'url(#fc-bar)')
          : isPlanned ? planColor : isExp ? 'var(--expected)' : 'var(--bar)';
        const past = p.end <= Date.now() ? ' opacity="0.45"' : '';
        const r = Math.min(4, bw / 2);
        // Rounded at the data end, square at the baseline.
        const up = p.total >= 0;
        const path = up
          ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
          : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + bw - r} Q${x + bw},${top + h} ${x + bw},${top + h - r} V${top} Z`;
        const outline = p.forecast ? ` stroke="${isPlanned ? 'var(--accent)' : isExp ? 'var(--expected)' : 'var(--bar)'}" stroke-width="1"` : '';
        bars += `<path d="${path}" fill="${fill}"${past}${outline}/>`;
        bars += `<rect class="hit" data-i="${i}" x="${X(p.start)}" y="${m.t}" width="${slot}" height="${ih}" fill="transparent"/>`;
      });

      // Battery actions as a thin band under the bars.
      let batteryMarks = '';
      if (d.battery && d.battery.actions) {
        const col = { charge: 'var(--battery)', hold: 'var(--muted)', no_discharge: 'var(--muted)' };
        for (const a of d.battery.actions) {
          if (!col[a.action] || a.end <= t0 || a.start >= t1) continue;
          batteryMarks += `<rect x="${X(Math.max(a.start, t0)).toFixed(1)}" y="${(Y(0) - 5).toFixed(1)}" width="${Math.max(1, X(Math.min(a.end, t1)) - X(Math.max(a.start, t0))).toFixed(1)}" height="4" fill="${col[a.action]}" opacity="${a.action === 'charge' ? 1 : 0.5}"/>`;
        }
      }
      // Expected solar surplus as a line (own scale, top of the chart).
      let solarCurve = '';
      const solPts = d.prices.filter((p) => Number.isFinite(p.solar_kw));
      if (solPts.length && solPts.some((p) => p.solar_kw > 0.05)) {
        const maxKw = Math.max(...solPts.map((p) => p.solar_kw), 1);
        const SY = (kw) => m.t + ih - (kw / maxKw) * ih * 0.9;
        const pts = solPts.map((p) => `${X((p.start + p.end) / 2).toFixed(1)},${SY(p.solar_kw).toFixed(1)}`).join(' ');
        solarCurve = `<polyline points="${pts}" fill="none" stroke="var(--solar)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" opacity="0.9"/>`;
      }
      const grid = ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/>
        <text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v.toFixed(2)}</text>`).join('');

      // X labels every 3 hours (6 for two days, only days for longer), on local time.
      const spanH = (t1 - t0) / 3600000;
      const hours = spanH > 60 ? 24 : spanH > 30 ? 6 : 3;
      let xl = '';
      for (let t = t0; t <= t1; t += 3600000) {
        const h = Number(tzFmt(t, { hour: '2-digit', hourCycle: 'h23' }));
        // (A minute-only format gives "0", not "00"; check the full time.)
        if (h % hours !== 0 || !tzFmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).endsWith(':00')) continue;
        const label = h === 0 ? tzFmt(t, { weekday: 'short' }) : `${String(h).padStart(2, '0')}:00`;
        xl += `<text x="${X(t)}" y="${H - 8}" text-anchor="${X(t) > W - m.r - 18 ? 'end' : 'middle'}" font-size="11" fill="var(--muted)"${h === 0 ? ' font-weight="600"' : ''}>${label}</text>`;
        if (h === 0 && t > t0) xl += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--border)"/>`;
      }

      const nowMs = Date.now();
      const nowX = X(nowMs);
      const marks = [];
      if (nowMs > t0 && nowMs < t1) {
        const anchor = nowX > W - 70 ? 'end' : 'start';
        const tx = anchor === 'end' ? nowX - 4 : nowX + 4;
        marks.push(`<line x1="${nowX}" x2="${nowX}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--text)" stroke-width="1.5"/>
          <text x="${tx}" y="13" text-anchor="${anchor}" font-size="11" fill="var(--text)">now</text>`);
      }
      if (d.reliability && d.reliability.latest_safe_start > t0 && d.reliability.latest_safe_start < t1) {
        const sx = X(d.reliability.latest_safe_start);
        const anchor = sx > W - 90 ? 'end' : 'start';
        const tx = anchor === 'end' ? sx - 4 : sx + 4;
        marks.push(`<line x1="${sx}" x2="${sx}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--warning)" stroke-width="1.5" stroke-dasharray="2 3"/>
          <text x="${tx}" y="28" text-anchor="${anchor}" font-size="11" fill="var(--warning)">latest safe start</text>`);
      }
      if (d.departure && d.plan.deadline && d.plan.deadline > t0 && d.plan.deadline <= t1) {
        const dx = X(d.plan.deadline);
        const anchor = dx < 90 ? 'start' : 'end';
        const tx = anchor === 'start' ? dx + 4 : dx - 4;
        marks.push(`<line x1="${dx}" x2="${dx}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="4 3"/>
          <text x="${tx}" y="43" font-size="11" text-anchor="${anchor}" fill="var(--text)">ready by</text>`);
      }

      // The next goal (after the trip), orange.
      const ng = d.next && d.next.goal;
      if (ng && ng.time > t0 && ng.time <= t1 && !(d.plan.deadline && Math.abs(ng.time - d.plan.deadline) < 60000)) {
        const gx = X(ng.time);
        const anchor = gx < 90 ? 'start' : 'end';
        const tx = anchor === 'start' ? gx + 4 : gx - 4;
        marks.push(`<line x1="${gx}" x2="${gx}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--expected)" stroke-width="1.5" stroke-dasharray="4 3"/>
          <text x="${tx}" y="43" font-size="11" text-anchor="${anchor}" fill="var(--expected)">next goal</text>`);
      }

      wrap.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Electricity price per interval with planned charging highlighted">
          <defs>
            <pattern id="fc-bar" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--bar)"/></pattern>
            <pattern id="fc-plan" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--accent)"/></pattern>
            <pattern id="fc-sol" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--solar)"/></pattern>
            <pattern id="fc-exp" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--expected)"/></pattern>
          </defs>
          ${grid}${bars}${solarCurve}${batteryMarks}
          <line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)"/>
          ${xl}${marks.join('')}
        </svg>
        <div class="tip" hidden></div>`;

      const tip = wrap.querySelector('.tip');
      wrap.querySelectorAll('.hit').forEach((el) => {
        el.addEventListener('mouseenter', () => {
          const p = d.prices[Number(el.dataset.i)];
          const blk = d.plan.blocks.find((b) => p.start <= b.start && b.start < p.end);
          const room = p.amps != null ? `<br><span class="src">Room for charger: ${p.amps ? `${Math.floor(p.amps)} A (${p.power_kw.toFixed(1)} kW)` : 'too little'}</span>` : '';
          const solText = Number.isFinite(p.solar_kw) ? `<br><span class="src">Sun: ${p.pv_kw.toFixed(1)} kW expected, ${p.solar_kw.toFixed(1)} kW left for the car, worth ${p.solar_price.toFixed(4)} /kWh</span>` : '';
          const fcText = p.forecast ? `<br><span class="src">Forecast: ${p.expected.toFixed(4)} expected + ${(p.total - p.expected).toFixed(2)} margin</span>` : '';
          tip.innerHTML = `<strong>${dayHm(p.start)}–${hm(p.end)}</strong><br>${p.total.toFixed(4)} /kWh${fcText}${solText}${room}${blk ? `<br><span style="color:${blk.solar_kwh > blk.kwh / 2 ? 'var(--solar)' : 'var(--accent)'}">■</span> Charge ${blk.kwh.toFixed(1)} kWh${blk.solar_kwh ? `, ${blk.solar_kwh.toFixed(1)} kWh from the sun` : ''}` : ''}`;
          const box = wrap.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, 70), box.width - 70)}px`;
          tip.style.top = `${(Y(p.total) / H) * box.height}px`;
          tip.hidden = false;
        });
        el.addEventListener('mouseleave', () => { tip.hidden = true; });
      });
    }

    // Icon and colour for the state on the Overview, as a Mushroom card would show it.
    function overviewShape(d, p, pw) {
      if (d.boost) return shape('bolt', 'amber');
      if (pw && pw.now_w > 500) return shape('battery', 'green');
      if (p.notes.includes('missing_data') || p.notes.includes('enter_soc')) return shape('alert', 'red');
      if (p.notes.includes('already_at_target')) return shape('check', 'green');
      if (p.blocks.length) return shape('clock', 'blue');
      return shape('sleep', 'grey');
    }

    function readyGuardHtml(d) {
      const r = d.reliability;
      if (!r) return '';
      const visual = {
        on_track: ['check', 'green'],
        at_risk: ['clock', 'amber'],
        action_needed: ['alert', 'orange'],
        not_achievable: ['alert', 'red'],
        advice_only: ['status', 'blue'],
        no_goal: ['clock', 'grey'],
        off: ['sleep', 'grey'],
      }[r.status] || ['status', 'grey'];
      const fact = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
      const done = r.needed_kwh === 0;
      const facts = [
        d.departure ? fact('Ready by', dayHm(d.departure.time)) : fact('Ready by', 'Not set'),
        !done && r.latest_safe_start ? fact('Latest safe start', dayHm(r.latest_safe_start)) : '',
        !done && r.expected_ready ? fact('Expected ready', dayHm(r.expected_ready)) : '',
        !done && r.safety_margin_minutes != null ? fact('Safety margin', durationText(r.safety_margin_minutes)) : '',
      ].join('');
      const chips = (r.factors || []).map((f) =>
        `<span class="reliability-chip ${esc(f.state)}"><i></i>${esc(f.label)}</span>`).join('');
      const current = d.vehicle && Number.isFinite(Number(d.vehicle.soc)) ? Number(d.vehicle.soc) : null;
      const target = d.planning && Number.isFinite(Number(d.planning.target_soc)) ? Number(d.planning.target_soc) : null;
      const progress = current != null ? Math.max(0, Math.min(100, current)) : 0;
      const targetPos = target != null ? Math.max(0, Math.min(100, target)) : null;
      return `<div class="card ready-card ready-${esc(r.status)}">
        <div class="ready-head">
          <div class="entity">${shape(visual[0], visual[1])}<div class="txt">
            <div class="ready-kicker">READY GUARD</div>
            <div class="ready-title">${esc(r.label)}</div>
            <div class="secondary">${esc(r.message)}</div>
          </div></div>
          <div class="ready-meta">
            <span class="advice${d.control_allowed ? ' live' : ''}">${d.control_allowed ? 'AUTOMATIC' : 'ADVICE ONLY'}</span>
            <span class="src">Updated ${esc(hm(d.computed_at))} · <a href="#" id="refresh-now">Refresh</a></span>
          </div>
        </div>
        ${current != null && target != null ? `<div class="ready-level">
          <div class="ready-level-label"><span>Battery <strong>${esc(current)}%</strong></span><span>Target <strong>${esc(target)}%</strong></span></div>
          <div class="ready-track"><span style="width:${progress}%"></span><i style="left:${targetPos}%"></i></div>
        </div>` : ''}
        <div class="ready-facts">${facts}</div>
        <div class="reliability-chips">${chips}</div>
      </div>`;
    }

    function overviewHtml(d) {
      if (d.missing.length) {
        const tabs = { prices: 'Prices', vehicle: 'Vehicle' };
        return `<div class="card"><h2>Almost there</h2><p class="muted">To make a plan, first set up: ${d.missing.map((k) => `<a href="#" data-goto="${k}"><strong>Settings › ${tabs[k]}</strong></a>`).join(' and ')}.</p></div>`;
      }
      const v = d.vehicle;
      const p = d.plan;
      const periodsList = p.periods.map((x) => `${dayHm(x.start)}–${hm(x.end)}`).join(', ');
      let headline;
      if (p.notes.includes('enter_soc')) headline = 'Enter the battery level to get a plan';
      else if (p.notes.includes('fixed_waiting')) headline = 'Waiting for the car to be plugged in';
      else if (p.notes.includes('already_at_target')) headline = 'No charging scheduled';
      else if (p.notes.includes('missing_data')) headline = 'Cannot plan yet';
      else if (!p.blocks.length) headline = 'No price blocks available before the deadline';
      else headline = `Charge ${p.planned_kwh.toFixed(1)} kWh · ${periodsList}${p.periods.some((x) => x.forecast) ? ' · partly forecast' : ''}`;
      if (d.boost && p.blocks.length) headline = `Charge now · ready around ${dayHm(p.blocks[p.blocks.length - 1].end)}`;

      const pw = d.power || null;
      const nowText = pw && pw.now_w != null ? (pw.now_w > 500 ? `charging at ${(pw.now_w / 1000).toFixed(1)} kW` : 'not charging') : '';
      let planText = '';
      if (pw) {
        const limit = `${pw.phases} × ${tidy(pw.amps)} A = ${pw.theoretical_kw.toFixed(1)} kW${d.assumed_current ? ', assumed' : pw.max_source === 'manual' ? ', set manually' : pw.max_name ? `, max from ${pw.max_name}` : ''}`;
        if (pw.learned && pw.learned.available) {
          planText = pw.learned.kw < pw.theoretical_kw - 0.05
            ? `Plan uses ${pw.planned_kw.toFixed(1)} kW from recent charging (charger allows ${limit})`
            : `Plan uses ${pw.planned_kw.toFixed(1)} kW · ${limit}`;
        } else {
          planText = `Plan uses ${pw.planned_kw.toFixed(1)} kW · ${limit}`;
        }
        if (d.house_load.available && p.blocks.some((b) => b.power_kw < pw.planned_kw - 0.05)) planText += ' · reduced in some blocks for house load';
      }
      const cd = v.car_data;
      const socText = v.soc != null ? `${cd && !cd.ok ? '~' : ''}${v.soc}%${v.mode === 'manual_soc' || (cd && !cd.ok) ? ' estimated' : ''}` : esc(v.soc_state || 'unknown');
      const vehicleLine = `${esc(v.name)} · ${v.mode === 'fixed_kwh' ? `${esc(v.fixed_kwh)} kWh per session` : `${socText} → ${d.planning.target_soc}%`}${d.departure ? ` · ${esc(dayHm(d.departure.time))}` : ' · no departure'}${nowText ? ` · ${esc(nowText)}` : ''}`;
      const notes = p.notes.map((n) => n === 'car_limit'
        ? carLimitNote(d.car_limit, d.planning.wanted_soc, d.control_allowed)
        : n === 'battery_care' && p.care
          ? `<div class="note">${shape('battery', 'green', true)} <strong>Battery care:</strong> up to ${esc(p.care.soc)}% when it is cheapest; the last part to ${esc(p.care.target)}% from ${esc(dayHm(p.care.window_start))}, just before departure, so the battery does not stand full for long. <a href="#" data-goto="ctlset">Settings › Rules</a></div>`
          : `<div class="note">${esc(NOTE_TEXT[n] || n)}</div>`).join('');

      return `
        ${connectedCarHtml(d)}
        ${readyGuardHtml(d)}
        ${nextGoalHtml(d)}
        <div class="overview-grid">
          <div class="overview-main">
            <div class="card chart-card">
              <div class="card-title-row"><div><h2>Prices and plan</h2><p class="muted small">All-in price per kWh${d.prices.length > 1 ? ` · ${Math.round((d.prices[1].start - d.prices[0].start) / 60000)} minute blocks` : ''}</p></div>
              <span class="chart-plan-chip">${p.planned_kwh != null ? `${tidy(p.planned_kwh)} kWh planned` : 'No plan'}</span></div>
              <div class="chart-wrap" id="chart"></div>
              <div class="legend"><span><i style="background:var(--accent)"></i>Planned</span><span><i style="background:var(--bar)"></i>Other prices</span>${d.battery && d.battery.actions && d.battery.actions.some((x) => x.action !== 'auto') ? '<span><i style="background:var(--battery)"></i>Home battery</span>' : ''}${d.prices.some((x) => Number.isFinite(x.solar_kw) && x.solar_kw > 0.05) ? '<span><i style="background:var(--solar)"></i>Solar</span>' : ''}${d.prices.some((x) => x.forecast) ? '<span><i class="striped"></i>Forecast</span>' : ''}${d.next && d.next.expected && d.next.expected.blocks.length ? '<span><i style="background:var(--expected)"></i>Expected after the trip</span>' : ''}</div>
              ${houseLoadHtml(d)}
              ${p.periods.length ? `<details class="table-details"><summary>Show plan table</summary>
                <table class="periods"><tr><th>Period</th><th class="n">Energy</th><th class="n">Avg price</th></tr>
                ${p.periods.map((x) => `<tr><td>${esc(dayHm(x.start))}–${esc(hm(x.end))}${x.forecast ? ' <span class="muted small">(forecast)</span>' : ''}</td><td class="n">${x.kwh.toFixed(1)} kWh</td><td class="n">${x.avg_price.toFixed(4)}</td></tr>`).join('')}
                </table></details>` : ''}
            </div>

            <details class="card plan-details">
              <summary><span><strong>Plan details</strong><small>${esc(headline)}</small></span><span class="details-chevron">⌄</span></summary>
              <div class="plan-detail-body">
                <p class="plan-vehicle">${vehicleLine}</p>
                ${planText ? `<p class="muted small">${esc(planText)}</p>` : ''}
                ${cd && !cd.ok ? `<div class="note"><strong>Car not reachable:</strong> battery data is ${cd.reason === 'stale' ? 'old' : 'unavailable'}; the plan uses ${esc(cd.estimate)}%.</div>` : ''}
                ${p.stage && d.charge_for ? `<p class="small">At least ${esc(d.charge_for.min_soc)}% before ${esc(dayHm(p.stage.first_deadline))}; the rest before ${esc(dayHm(d.departure.time))}.</p>` : ''}
                ${!d.boost ? limitLine(d.limit, true) : ''}
                ${p.cost != null ? `<div class="stats">
                  <div class="stat">${shape('cash', 'blue', true)}<div><div class="v">${money(p.cost)}</div><div class="l">${d.boost ? 'Cost now' : 'Planned cost'}</div></div></div>
                  ${!d.boost ? `<div class="stat">${shape('savings', 'green', true)}<div><div class="v">${money(p.savings)}</div><div class="l">Saving</div></div></div>` : ''}
                </div>` : ''}
                ${vehicleSessionHtml(d)}
                ${continuousNote(p)}
                ${notes}
                ${d.price_error ? `<div class="error">Prices could not be loaded: ${esc(d.price_error)}</div>` : ''}
              </div>
            </details>
          </div>
          <aside class="overview-side">
            ${quickHtml(d)}
            ${batteryHtml(d)}
          </aside>
        </div>`;
    }

    // ---------- Looking ahead: after this trip, the next goal ----------
    function tripText(t) {
      if (!t) return '';
      const how = t.how === 'estimate' ? ' (straight line × 1.3, estimate)' : '';
      const use = t.use === 'learned' ? 'learned from your trips' : t.use === 'range' ? "from the car's range" : t.use === 'consumption' ? 'from the use per 100 km' : '';
      switch (t.status) {
        case 'ok': return `~${esc(Math.round(t.km))} km one way${how}${t.back_km != null && Math.abs(t.back_km - t.km) > 0.5 ? `, ~${esc(Math.round(t.back_km))} km back` : ''} · there and back ≈ <strong>${esc(Math.round(t.pct))}%</strong>${use ? ` <span class="muted">(${use}, +10%)</span>` : ''}`;
        case 'home': return 'At home: no trip';
        case 'pending': return 'Looking up the distance (OpenStreetMap)…';
        case 'no_consumption': return `~${esc(tidy(t.km))} km; set the battery capacity or the use per 100 km (Settings › Vehicle) to see what it costs`;
        case 'no_home': return 'Set your home location in Home Assistant (Settings › System › General) to see what trips cost';
        default: return t.reason === 'not_an_address' ? 'Put the address in the event\'s location to see what the trip costs' : t.reason === 'not_found' ? 'Address not found on OpenStreetMap' : '';
      }
    }

    function nextGoalHtml(d) {
      const n = d.next;
      if (!n || (!n.goal && n.trip.pct == null)) return '';
      const e = n.expected;
      const low = !!(e && e.below_goal);
      const tripLine = tripText(n.trip);
      const cur = `${esc(dayHm(n.current.time))}${n.current.title ? ` · ${esc(n.current.title)}` : ''}`;
      const back = n.trip.soc_after != null && n.trip.pct != null
        ? `Back home around ${esc(dayHm(n.trip.return_at))}${n.trip.return_trip ? ` (${esc(n.trip.return_trip.title)})` : ''} with about <strong class="${low ? 'warn-text' : ''}">${esc(tidy(n.trip.soc_after))}%</strong>.` : '';
      let exp = '';
      if (n.goal && e) {
        exp = !e.below_goal ? `Enough for the next goal: no charging expected.`
          : e.blocks.length
            ? `Expected: <strong>~${esc(tidy(e.needed_kwh))} kWh</strong> to charge ${e.periods.length ? `(${e.periods.map((x) => `${esc(dayHm(x.start))}–${esc(hm(x.end))}`).join(', ')})` : ''}${e.cost != null ? ` · ~${money(e.cost)}` : ''}${e.uses_forecast ? ' · partly forecast prices' : ''}${e.planned_kwh < e.needed_kwh - 0.1 ? ' · the rest when more prices are known' : ''}.`
            : `Expected: <strong>~${esc(tidy(e.needed_kwh))} kWh</strong> to charge; prices for then are not known yet.`;
      } else if (n.goal && n.trip.pct == null) {
        exp = 'What the trip costs is not known, so no charging is expected yet.';
      }
      return `<div class="card next-goal${low ? ' low' : ''}">
        <div class="ready-kicker">AFTER ${esc(cur.toUpperCase())}</div>
        ${n.goal ? `<h2>${shape('flag', low ? 'orange' : 'blue', true)}Next goal: ${esc(dayHm(n.goal.time))} · ${esc(n.goal.soc)}%${n.goal.title ? ` · ${esc(n.goal.title)}` : ''}</h2>` : '<h2>No next departure in the coming week</h2>'}
        ${tripLine ? `<p class="small">This trip: ${tripLine}</p>` : ''}
        ${back ? `<p class="small">${back}</p>` : ''}
        ${exp ? `<p class="small ${low ? 'warn-text' : 'muted'}">${exp}</p>` : ''}
        <p class="muted small">An expectation: the real plan follows when the car is back and plugged in.</p>
      </div>`;
    }

    // ---------- More than one car: which one is connected ----------
    function connectedCarHtml(d) {
      const c = d.cars;
      if (!c) return '';
      const cur = c.list.find((x) => x.id === c.connected_id);
      const name = cur ? esc(cur.name) : 'a car';
      const conflictCar = c.conflict ? c.list.find((x) => x.id === c.conflict) : null;
      const HOW = {
        chosen: `Chosen by you. Back to automatic when the car is unplugged.${conflictCar ? ` <strong>Note:</strong> ${esc(conflictCar.name)} says it is plugged in.` : ''}`,
        sensor: `Recognised by its plug sensor.`,
        charging_sensor: `Recognised by its charging sensor.`,
        no_other: `No other car says it is plugged in.`,
        last: `No car connected. The plan is for ${name}, the last car that was connected.`,
        first: `No car connected. The plan is for ${name}.`,
        usual: `No car connected. The plan is for ${name}, the usual car on this charger.`,
        only: `The other car is on another charger, so this is ${name}.`,
        guess: `The app cannot tell which car is connected and plans for ${name} for now. <strong>Which car is it?</strong>`,
      };
      const connected = c.charger_plugged !== false && !['last', 'first', 'usual'].includes(c.how);
      return `
        <div class="card connected-car${c.ask ? ' attention' : ''}">
          <div class="card-title-row"><div>
            <div class="ready-kicker">${connected ? "CONNECTED CAR" : "NEXT CAR"}</div>
            <h2>${shape('car', c.ask ? 'orange' : 'blue', true)}${name}</h2>
          </div></div>
          <p class="muted small">${HOW[c.how] || ''}</p>
          <div class="buttons car-picker">
            ${c.list.map((x) => `<button type="button" class="${c.chosen && x.id === c.connected_id ? 'primary' : 'secondary'}" data-connect="${esc(x.id)}">${esc(x.name)}</button>`).join('')}
            <button type="button" class="${c.chosen ? 'secondary' : 'primary'}" data-connect="">Automatic</button>
          </div>
        </div>`;
    }

    function bindCars() {
      document.querySelectorAll('[data-connect]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            await api('POST', 'api/vehicles/connected', { vehicle_id: b.dataset.connect || null });
          } catch (err) {
            alert(err.message);
          }
          loadOverview(true);
        };
      });
    }

    // ---------- Charge now ----------
    // The car stops at its own charge limit.
    function carLimitNote(lim, wanted, controlAllowed) {
      if (!lim || lim.value == null) return '';
      const why = !lim.writable
        ? 'Your car does not allow changing it from Home Assistant: raise it in the car or its app to charge further.'
        : !controlAllowed
          ? 'The app sets it automatically once Allow control is on.'
          : 'Changing it automatically is off in Settings › Rules.';
      return `<div class="note">Your car stops charging at <strong>${esc(lim.value)}%</strong> (${esc(lim.name)}), below the wanted ${esc(wanted)}%. The app plans up to ${esc(lim.value)}%. ${why}</div>`;
    }

    // What happens with the car's own charge limit for a choice.
    function limitLine(l, compact) {
      if (!l || l.reason === 'none' || l.now == null) return '';
      if (l.managed) {
        if (l.to !== l.now) return `<p class="small">${shape('car', 'green', true)} Car's charge limit: ${esc(l.now)}% → <strong>${esc(l.to)}%</strong>, set automatically${compact ? '' : ', and back when this ends'}.</p>`;
        return compact ? '' : `<p class="small muted">Car's charge limit stays at ${esc(l.now)}% (already right).</p>`;
      }
      if (!(l.goal > l.now)) return '';
      const why = l.reason === 'read_only' ? 'Your car does not allow changing it from Home Assistant; raise it in the car or its app.'
        : l.reason === 'control_off' ? 'The app changes it automatically once Allow control is on.'
          : 'Changing it automatically is off in Settings › Rules.';
      return `<div class="note">Car's charge limit is ${esc(l.now)}%, below ${esc(l.goal)}%. ${why}</div>`;
    }

    function bindRaiseLimit(after) {
      document.querySelectorAll('.raise-limit').forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          const out = btn.parentElement.querySelector('.raise-result');
          btn.disabled = true;
          btn.textContent = 'Sending…';
          try {
            const r = await api('POST', 'api/vehicle/charge_limit', { value: btn.dataset.value });
            out.innerHTML = `<p class="small"><span class="ok">Sent: ${esc(r.value)}%.</span>${Number(r.value) !== Number(btn.dataset.value) ? ' (rounded up to a value the car accepts)' : ''} The car can take a few minutes to report the new limit.</p>`;
            setTimeout(after, 4000);
          } catch (err) {
            out.innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
            btn.disabled = false;
            btn.textContent = `Raise the car's limit to ${btn.dataset.value}%`;
          }
        };
      });
    }

    function boostGoalText(b, d) {
      if (b.mode === 'soc') return `up to ${b.value}%`;
      if (b.mode === 'kwh') return `${b.value} kWh`;
      return `up to the plan's target (${d.planning.target_soc}%)`;
    }

    let boostMessage = '';

    // Result of a real start/stop command.
    function sendHtml(send, verb) {
      if (!send) return '';
      if (send.sent) return `<div class="note">${verb} sent to the charger at ${esc(hm(send.at))}${send.command ? `: <span class="cmd">${esc(send.command.service)}</span>` : ''}.</div>`;
      if (send.note) return `<div class="note">${esc(send.note)}.</div>`;
      if (send.error) return `<div class="${/Allow control is off/.test(send.error) ? 'note' : 'error'}">${verb} not sent: ${esc(send.error)}.</div>`;
      return '';
    }

    // ---------- Quick choices on Home ----------
    let minDefault = 30;

    function quickHtml(d) {
      if (d.boost) return boostHtml(d);
      const v = d.vehicle || {};
      const opts = [];
      if (d.normal_plan && d.normal_plan.needed_kwh != null) opts.push(`<option value="target">Plan target (${d.planning.target_soc}%)</option>`);
      if (v.soc != null && v.mode !== 'fixed_kwh') opts.push('<option value="soc">Battery level</option>');
      opts.push('<option value="kwh">Fixed amount (kWh)</option>');
      const canMin = v.soc != null && v.mode !== 'fixed_kwh';
      return `
        <div class="card quick">
          <div class="card-title-row"><h2>${shape('bolt', 'amber', true)} Quick choices</h2><span class="src">Temporary</span></div>
          ${modeHtml(d)}
          <div class="qsec action-tile">
            <div class="qhead">${shape('bolt', 'blue', true)}<div><strong>Charge now</strong><div class="muted small">Start immediately, up to a goal you choose.</div></div></div>
            <form id="boost-form" class="choice-form">
              <select name="mode" aria-label="Charge now goal">${opts.join('')}</select>
              <div class="choice-value"><input name="value" type="number" step="any" min="0" hidden><span class="muted small" id="boost-unit"></span></div>
              <button class="primary" type="submit">Continue</button>
            </form>
            <div id="boost-check">${boostMessage}</div>
          </div>
          ${canMin ? `
          <div class="qsec action-tile">
            <div class="qhead">${shape('battery', 'purple', true)}<div><strong>Quick minimum</strong><div class="muted small">Charge immediately to this level, then resume the plan.</div></div></div>
            <form id="min-form" class="choice-form slider-choice">
              <div class="field"><label>Minimum <output class="range-value">${minDefault}%</output></label>
                <input name="value" type="range" min="20" max="45" step="5" value="${minDefault}" data-mushroom-range="1" data-unit="%">
              </div>
              <button class="secondary" type="submit">Continue</button>
            </form>
            <div id="min-check"></div>
          </div>` : ''}
          <div class="qsec action-tile">
            <div class="qhead">${shape('flag', d.charge_for ? 'blue' : 'grey', true)}<div><strong>Ready later</strong><div class="muted small">Move the goal to tomorrow or the day after when that is cheaper.</div></div></div>
            <div id="cf-box"><p class="muted small">Loading…</p></div>
          </div>
        </div>`;
    }

    // How to charge: price plan, plan and solar, solar only.
    const MODE_TEXT = {
      plan: 'Only the price plan; the sun is not used for the car.',
      plan_solar: 'The price plan, counting on the expected sun, plus charging on surplus whenever there is some.',
      solar: 'Only on solar surplus, nothing from the grid by the plan. Charge now and the minimum still work.',
    };
    function modeHtml(d) {
      const sol = d.solar || {};
      // Without solar there is nothing to choose: setting it up is in Settings › Solar.
      if (!sol.enabled) return '';
      const n = d.solar_now;
      let now = '';
      if (n && sol.mode !== 'plan') {
        const kw = (w) => `${(Math.abs(w) / 1000).toFixed(1)} kW`;
        const gridTxt = Number.isFinite(n.grid_w) ? (n.grid_w < 0 ? `exporting ${kw(n.grid_w)}` : `importing ${kw(n.grid_w)}`) : 'grid meter not readable';
        now = `<p class="small">${shape('sun', n.code === 'solar' ? 'amber' : 'grey', true)} Now: ${esc(gridTxt)}${n.code === 'solar' ? (n.equalizer ? ' · charging on solar through the Easee Equalizer' : ` · charging on solar at ${esc(n.amps)} A${n.phases === 1 ? ', one phase' : ''}`) : ''}. <span class="muted">${n.equalizer && n.code === 'solar' ? '' : esc(n.reason || '')}</span></p>`;
      }
      return `
          <div class="qsec action-tile mode-tile">
            <div class="qhead">${shape('sun', sol.mode === 'plan' ? 'grey' : 'amber', true)}<div><strong>Charging mode</strong><div class="muted small">${esc(MODE_TEXT[sol.mode])}</div></div></div>
            <div class="mode-pills">
              ${[['plan', 'Price plan'], ['plan_solar', 'Plan + solar'], ['solar', 'Solar only']].map(([k, l]) => `<button class="${sol.mode === k ? 'primary' : 'secondary'} mode-btn" data-mode="${k}">${l}</button>`).join('')}
            </div>
            ${now}
            ${Number.isFinite(sol.expected_kwh_left_today) && sol.mode !== 'plan' ? `<p class="muted small">Expected sun left today for the house and the car: ${tidy(sol.expected_kwh_left_today)} kWh (${esc(sol.forecast_source === 'energy' ? 'Energy dashboard forecast' : 'forecast sensor')}).</p>` : ''}
          </div>`;
    }

    function bindModes() {
      document.querySelectorAll('.mode-btn').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            await api('POST', 'api/chargemode', { mode: b.dataset.mode });
          } catch (err) {
            alertBox(err.message);
          }
          loadOverview(true);
        };
      });
    }

    function alertBox(msg) {
      const box = document.querySelector('.quick');
      if (box) box.insertAdjacentHTML('afterbegin', `<div class="error">${esc(msg)}</div>`);
    }

    // When and for what a ready-for choice was made.
    function cfOrigin(a) {
      const when = a.created ? `Chosen ${esc(dayHm(a.created))}` : 'Chosen';
      const what = a.based_on
        ? `for ${a.based_on.title ? esc(a.based_on.title) : esc(SOURCE_NAMES[a.based_on.source] || a.based_on.source)} (${esc(dayHm(a.based_on.time))}); ends by itself when that departure is removed`
        : 'when no departure was planned that day';
      return `${when}, ${what}.`;
    }

    function cfInfoHtml(c, o, until, minSoc) {
      const parts = [];
      if (o.before.length) {
        parts.push(`<div class="note">Before then: ${o.before.map((b) => `<strong>${esc(dayHm(b.time))}</strong> (${esc(SOURCE_NAMES[b.source] || b.source)}${b.title ? ': ' + esc(b.title) : ''})`).join(', ')}. ${o.before.length > 1 ? 'These get' : 'It gets'} at least <strong>${esc(minSoc)}%</strong>; the app charges that first, in the cheapest hours before it.${c.soc == null ? ' <span class="differ">The battery level is unknown, so the minimum cannot be checked.</span>' : ''}</div>`);
      }
      if (c.prices_until && c.prices_until >= until) parts.push('<p class="small muted">Prices are known up to then.</p>');
      else if (c.forecast) parts.push(`<p class="small muted">Real prices are known until ${esc(dayHm(c.prices_until))}; after that the price forecast is used. The plan is updated when the real prices come out (around 13:00), and never charges on a forecast price.</p>`);
      else parts.push(`<div class="note">No price forecast: the app only knows prices until ${c.prices_until ? esc(dayHm(c.prices_until)) : 'now'}. It plans with those and updates when new prices come out (around 13:00). Add a forecast in <a href="#" data-goto="prices">Settings › Prices</a> to choose the cheapest day.</div>`);
      return parts.join('');
    }

    async function loadChargeFor() {
      const box = $('cf-box');
      if (!box) return;
      let c;
      try {
        c = await api('GET', 'api/chargefor');
      } catch (err) {
        box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
        return;
      }
      minDefault = c.min_default;
      const mf = $('min-form');
      if (mf && !mf.contains(document.activeElement)) {
        mf.value.value = String(c.min_default);
        refreshRangeValues(mf);
      }
      const a = c.active;
      if (a) {
        box.innerHTML = `
          <p>Ready <strong>${esc(dayHm(a.until))}</strong> at <strong>${esc(a.soc)}%</strong>${a.interim ? `, and at least <strong>${esc(a.min_soc)}%</strong> before ${esc(dayHm(a.interim.time))} (${esc(SOURCE_NAMES[a.interim.source] || a.interim.source)}${a.interim.title ? ': ' + esc(a.interim.title) : ''})` : ''}.</p>
          ${limitLine(c.limit)}
          <p class="muted small">${cfOrigin(a)} Ends by itself after ${esc(dayHm(a.until))}.</p>
          <button class="secondary" id="cf-clear">Back to normal</button>`;
        $('cf-clear').onclick = async () => {
          $('cf-clear').disabled = true;
          await api('DELETE', 'api/chargefor');
          loadOverview(true);
        };
        return;
      }
      const label = { tomorrow: 'Tomorrow', day_after: 'Day after tomorrow' };
      const optText = (o) => `${esc(o.time)} · ${esc(o.soc)}%${o.from ? '' : ' (no departure that day)'}`;
      box.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${['tomorrow', 'day_after'].map((k) => `<button class="secondary cf-day" data-day="${k}">${label[k]} <span class="muted small">${optText(c.options[k])}</span></button>`).join('')}
        </div>
        <form id="cf-form" hidden style="margin-top:12px">
          <div class="two">
            <div class="field"><label>Ready at</label><input name="time" type="time" step="300" required></div>
            <div class="field"><label>Battery level (%)</label><input name="soc" type="number" min="10" max="100" step="1" required></div>
          </div>
          <div class="field cf-min"><label>Minimum for departures before then</label>
            <select name="min_soc">${[20, 25, 30, 35, 40, 45].map((m) => `<option value="${m}">${m}%</option>`).join('')}</select></div>
          <div id="cf-info"></div>
          <div id="cf-limit"></div>
          <div class="buttons"><button class="primary" type="submit">Use this</button><button class="secondary" type="button" id="cf-cancel">Cancel</button></div>
          <div class="error form-error" hidden></div>
        </form>`;
      const f = $('cf-form');
      let day = null;
      const untilOf = () => {
        const o = c.options[day];
        // The chosen time on that date (shown in the plan's time zone).
        return Date.parse(`${o.date}T${f.time.value || o.time}:00`) - tzOffsetGuess(o.date);
      };
      const refresh = async () => {
        const o = c.options[day];
        f.querySelector('.cf-min').hidden = !o.before.length;
        $('cf-info').innerHTML = cfInfoHtml(c, o, untilOf(), f.min_soc.value);
        bindGoto($('cf-info'));
        try {
          const r = await api('POST', 'api/chargefor/preview', { day, time: f.time.value, soc: f.soc.value, min_soc: f.min_soc.value });
          $('cf-limit').innerHTML = limitLine(r.limit);
        } catch (err) {
          $('cf-limit').innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
        }
      };
      box.querySelectorAll('.cf-day').forEach((b) => {
        b.onclick = () => {
          day = b.dataset.day;
          box.querySelectorAll('.cf-day').forEach((x) => x.classList.toggle('primary', x === b));
          const o = c.options[day];
          f.time.value = o.time;
          f.soc.value = o.soc;
          f.min_soc.value = String(c.min_default);
          f.hidden = false;
          refresh();
        };
      });
      f.onchange = refresh;
      $('cf-cancel').onclick = () => {
        f.hidden = true;
        box.querySelectorAll('.cf-day').forEach((x) => x.classList.remove('primary'));
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.form-error');
        err.hidden = true;
        try {
          await api('POST', 'api/chargefor', { day, time: f.time.value, soc: f.soc.value, min_soc: f.min_soc.value });
          loadOverview(true);
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      };
    }

    // Offset of the plan's time zone on a date, to turn a local time into a moment.
    function tzOffsetGuess(date) {
      const t = Date.parse(`${date}T12:00:00Z`);
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: lastPlan.time_zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
      const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
      return Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute) - t;
    }

    function bindGoto(root) {
      root.querySelectorAll('[data-goto]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); showTab(a.dataset.goto); }; });
    }

    function boostHtml(d) {
      const b = d.boost;
      if (b) {
        return `
        <div class="card">
          <h2>${shape('bolt', 'amber', true)} Charge now is on</h2>
          <p>Charging ${esc(boostGoalText(b, d))}, started at ${esc(hm(b.started))}.
            ${b.remaining_kwh != null ? `Still ${tidy(b.remaining_kwh)} kWh to go${b.end ? `, ready around ${esc(dayHm(b.end))}` : ''}.` : ''}</p>
          ${b.error ? `<div class="error">${esc(b.error)}</div>` : ''}
          ${sendHtml(b.send, 'Start')}
          <p class="muted small">Stops by itself when the goal is reached or the car is unplugged; then the normal plan takes over again.${d.control_allowed ? ' When the goal is reached or you stop it, the plan takes over again and starts or pauses the charger.' : ' Allow control is off: nothing is sent to the charger, the Log tab shows what would be sent.'}</p>
          <button class="secondary" id="boost-stop">Stop charge now</button>
        </div>`;
      }
      const v = d.vehicle || {};
      const opts = [];
      if (d.normal_plan && d.normal_plan.needed_kwh != null) opts.push(`<option value="target">Up to the plan's target (${d.planning.target_soc}%)</option>`);
      if (v.soc != null && v.mode !== 'fixed_kwh') opts.push('<option value="soc">Up to a battery level</option>');
      opts.push('<option value="kwh">A fixed amount (kWh)</option>');
      return `
        <div class="card">
          <h2>${shape('bolt', 'grey', true)} Charge now</h2>
          <p class="muted small">Charge right away instead of waiting for the cheapest hours. The app first checks whether charging is already planned soon.</p>
          <form id="boost-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select name="mode">${opts.join('')}</select>
            <input name="value" type="number" step="any" min="0" style="width:100px" hidden>
            <span class="muted small" id="boost-unit"></span>
            <button class="secondary" type="submit">Check</button>
          </form>
          <div id="boost-check">${boostMessage}</div>
        </div>`;
    }

    function boostCheckHtml(r, prefix = 'boost') {
      const parts = [];
      if (r.plugged === false) parts.push('<div class="error">The car is not plugged in.</div>');
      if (r.running) parts.push(`<div class="note">The plan is already charging now, until ${esc(hm(r.running.end))}. Charge now only helps if you need more than the plan gives.</div>`);
      else if (r.soon) {
        const mins = Math.max(1, Math.round((r.soon.start - Date.now()) / 60000));
        parts.push(`<div class="note">Charging is already planned soon: from ${esc(hm(r.soon.start))} (in ${mins} min) until ${esc(hm(r.soon.end))}, at ${r.soon.avg_price.toFixed(4)} /kWh on average. Waiting may be enough.</div>`);
      }
      if (r.above_limit) parts.push(carLimitNote(r.car_limit, r.wanted_soc, r.control_allowed));
      else parts.push(limitLine(r.limit));
      if (!(r.kwh > 0.01)) {
        if (!r.above_limit) parts.push('<p>Nothing to charge: the battery is already at that level.</p>');
        return parts.join('');
      }
      const n = r.now;
      const pl = r.plan;
      const line = (label, x) => (x.start ? `<tr><td>${label}</td><td>${esc(dayHm(x.start))}–${esc(hm(x.end))}</td><td class="n">${tidy(x.kwh)} kWh</td><td class="n">${money(x.cost)}</td></tr>` : `<tr><td>${label}</td><td colspan="3" class="muted">not possible with the known prices</td></tr>`);
      parts.push(`
        <table class="periods" style="margin-top:10px"><tr><th></th><th>When</th><th class="n">Energy</th><th class="n">Cost</th></tr>
          ${line('Charge now', n)}
          ${line(r.departure ? 'Cheapest before departure' : 'Cheapest known hours', pl)}
        </table>
        ${n.start && pl.start && n.kwh + 0.05 < r.kwh ? '<div class="note">Not all of it fits in the hours with known prices.</div>' : ''}
        ${r.extra_cost != null ? `<p>${r.extra_cost > 0.005 ? `Charging now costs about <strong>${money(r.extra_cost)}</strong> more.` : 'Charging now costs about the same.'}</p>` : ''}`);
      if (r.plugged !== false && !r.above_limit) {
        parts.push(`<div style="display:flex;gap:8px"><button class="primary" id="${prefix}-start">Charge now</button><button class="secondary" id="${prefix}-cancel">Cancel</button></div>
          <p class="muted small">${lastPlan && lastPlan.control_allowed ? 'This really starts the charger now (Allow control is on).' : 'Allow control is off: this only changes what the app would do (see the Log tab); nothing is sent to the charger.'}</p>`);
      }
      return parts.join('');
    }

    function bindBoost() {
      const stop = $('boost-stop');
      if (stop) stop.onclick = async () => {
        stop.disabled = true;
        stop.textContent = 'Stopping…';
        const r = await api('DELETE', 'api/boost');
        boostMessage = `<p class="muted small">Charge now stopped.${r.next ? ` The plan takes over: ${esc(wantText(r.next).toLowerCase())} (${esc(r.next.reason)}).` : ''}</p>${sendHtml(r.send, r.send && r.send.command && r.send.command.what === 'start charging' ? 'Start' : 'Pause')}`;
        await loadOverview();
        setTimeout(() => { boostMessage = ''; }, 60000);
      };
      const f = $('boost-form');
      if (!f) return;
      const syncMode = () => {
        const m = f.mode.value;
        f.value.hidden = m === 'target';
        f.value.required = m !== 'target';
        $('boost-unit').textContent = m === 'soc' ? '%' : m === 'kwh' ? 'kWh' : '';
        f.value.placeholder = m === 'soc' ? '90' : '10';
        $('boost-check').innerHTML = '';
      };
      f.mode.onchange = syncMode;
      syncMode();
      f.onsubmit = (e) => {
        e.preventDefault();
        runBoostCheck({ mode: f.mode.value, value: f.value.value }, $('boost-check'), 'boost');
      };
      const mf = $('min-form');
      if (mf) mf.onsubmit = (e) => {
        e.preventDefault();
        runBoostCheck({ mode: 'soc', value: mf.value.value }, $('min-check'), 'min');
      };
    }

    // Check a Charge now goal and offer to start it.
    async function runBoostCheck(goal, box, prefix) {
        boostMessage = '';
        box.innerHTML = '<p class="muted small">Checking…</p>';
        try {
          const r = await api('POST', 'api/boost/preview', goal);
          box.innerHTML = boostCheckHtml(r, prefix);
          const go = $(`${prefix}-start`);
          if (go) go.onclick = async () => {
            go.disabled = true;
            go.textContent = 'Starting…';
            try {
              await api('POST', 'api/boost', goal);
              loadOverview();
            } catch (err) {
              box.insertAdjacentHTML('beforeend', `<div class="error">${esc(err.message)}</div>`);
              go.disabled = false;
              go.textContent = 'Charge now';
            }
          };
          const cancel = $(`${prefix}-cancel`);
          if (cancel) cancel.onclick = () => { box.innerHTML = ''; };
        } catch (err) {
          box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
        }
    }

    function vehicleSessionHtml(d) {
      const v = d.vehicle;
      if (!v || v.mode === 'sensor' || !v.mode) return '';
      const ss = v.session || {};
      const since = ss.since ? `since ${esc(dayHm(ss.since))}${ss.since_known ? '' : ' (plugged in before the app saw it)'}` : '';
      const counting = ss.counting ? '' : ' <span class="src">No charging power sensor in Settings › Charger, so charged energy is not counted.</span>';
      if (v.mode === 'fixed_kwh') {
        return `<p class="muted small">Fixed amount: ${esc(v.fixed_kwh)} kWh per session · ${ss.plugged ? `${tidy(ss.kwh_since)} kWh charged ${since}` : 'car not plugged in'}${counting}</p>`;
      }
      const entered = ss.manual_soc ? `You entered ${esc(ss.manual_soc.value)}% at ${esc(hm(ss.manual_soc.at))}; ${tidy(ss.kwh_since)} kWh charged since.` : 'No battery level entered for this session yet.';
      return `
        <form class="row" id="soc-form" style="align-items:center;border:none">
          <span class="label">Battery level now (estimate)</span>
          <span style="display:flex;gap:8px;align-items:center">
            <input name="soc" type="number" min="0" max="100" step="1" style="width:90px" placeholder="%" required>
            <button class="secondary" type="submit">Set</button>
          </span>
        </form>
        <p class="muted small">${entered}${counting} The entered level is forgotten when the car is unplugged.</p>`;
    }

    function continuousNote(p) {
      const c = p.continuous;
      if (!c || c.split_saving < 0.005) return '';
      return c.used
        ? `<p class="muted small">Charging in one go. Splitting it would save only ${money(c.split_saving)}, less than your ${money(c.threshold)}.</p>`
        : `<p class="muted small">Charging is split because that saves ${money(c.split_saving)} (more than your ${money(c.threshold)}).</p>`;
    }

    function houseLoadHtml(d) {
      const h = d.house_load;
      if (!h.available) {
        const why = {
          not_enough_history: 'Not enough history from your grid meter yet (it needs long-term statistics); the plan assumes full charging power.',
          statistics_error: 'The history of your grid meter could not be read; the plan assumes full charging power.',
        }[h.reason];
        return why ? `<div class="note">${esc(why)}</div>` : '';
      }
      const prof = h.profile;
      const peakHour = prof.indexOf(Math.max(...prof));
      const night = prof.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      const kw = (w) => (w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);
      return `<p class="muted small" style="margin-top:10px">Typical house load (last ${h.days} days${h.charger_subtracted ? ', without the charger' : ''}): about ${kw(night)} at night, up to ${kw(prof[peakHour])} around ${String(peakHour).padStart(2, '0')}:00. Main fuse ${esc(h.main_fuse)} A.</p>`;
    }

    // More chargers: every charger at a glance, on top of Home.
    function chargersOverviewHtml(o) {
      if (!o || !o.multi_charger) return '';
      const sh = o.share;
      const rank = sh && sh.order ? sh.order : [];
      const row = (c) => {
        const status = c.plugged === false ? 'No car connected'
          : c.charging ? `Charging${c.power_w ? ` · ${(c.power_w / 1000).toFixed(1)} kW` : ''}${c.shared && c.amps ? ` · ${c.amps} A (shared)` : ''}`
            : c.code === 'shared_wait' ? 'Waiting for the other charger'
              : c.want === 'charge' ? 'Starting' : 'Waiting for the plan';
        const first = rank.length > 1 && rank[0] === c.id ? '<span class="chip">goes first</span>' : '';
        return `<button type="button" class="charger-row${c.id === chargerSel ? ' active' : ''}" data-bar="${esc(c.id)}">
          ${shape('charger', c.charging ? 'green' : c.code === 'shared_wait' ? 'orange' : 'blue', true)}
          <span class="charger-row-main"><strong>${esc(c.name)}</strong> ${first}
            <span class="muted small">${c.vehicle ? `${esc(c.vehicle.name)}${c.vehicle.soc != null ? ` · ${esc(c.vehicle.soc)}%` : ''}` : 'No car'}${c.ask ? ' · which car?' : ''}${c.departure ? ` → ${esc(c.departure.soc)}% ${esc(dayHm(c.departure.time))}` : ''}</span></span>
          <span class="charger-row-state small">${esc(status)}${c.ready_guard ? `<br><span class="muted">${esc(c.ready_guard.label)}</span>` : ''}</span>
        </button>`;
      };
      const how = !sh ? '' : sh.how === 'load_balancer' ? 'Your load balancer shares the connection.'
        : sh.available_a != null ? `${esc(tidy(sh.available_a))} A per phase is free for the chargers now (main fuse ${esc(sh.main_fuse)} A).`
          : 'Set up the grid meter and main fuse (Settings › Grid) so the chargers share the connection.';
      return `<div class="card chargers-card">
        <div class="ready-kicker">CHARGERS</div>
        ${o.chargers.map(row).join('')}
        <p class="muted small">${how} When there is not enough for all, the car with the least room to spare goes first; the rest is shared.</p>
      </div>`;
    }

    async function loadOverview(force = false) {
      try {
        const d = await api('GET', force ? 'api/plan?refresh=1' : 'api/plan');
        lastPlan = d;
        const ov = multiCharger ? await api('GET', 'api/chargers/overview').catch(() => null) : null;
        $('overview-body').innerHTML = chargersOverviewHtml(ov) + overviewHtml(d);
        $('overview-body').querySelectorAll('.chargers-card [data-bar]').forEach((b) => { b.onclick = () => selectCharger(b.dataset.bar); });
        enhanceRangeControls($('overview-body'));
        refreshRangeValues($('overview-body'));
        drawChart(d);
        const sf = $('soc-form');
        if (sf) sf.onsubmit = async (e) => {
          e.preventDefault();
          await api('POST', 'api/vehicle/soc', { soc: sf.soc.value });
          loadOverview(true);
        };
        bindBoost();
        bindModes();
        bindCars();
        loadChargeFor();
        const rn = $('refresh-now');
        if (rn) rn.onclick = async (e) => { e.preventDefault(); rn.textContent = 'Refreshing…'; await loadOverview(true); };
      } catch (err) {
        $('overview-body').innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    window.addEventListener('resize', () => { if (lastPlan) drawChart(lastPlan); });

    // ---------- Departures ----------
    const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    const SOURCE_NAMES = { override: 'One-off', calendar: 'Calendar', helper: 'Helper', schedule: 'Schedule', choice: 'Your choice' };
    let depTz = 'UTC';

    const depFmt = (ms, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: depTz, ...opts }).format(new Date(ms));
    const depWhen = (ms) => depFmt(ms, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const leaveOf = (x) => x.event_start || x.time;
    const readyBy = (x) => (x.event_start && x.event_start !== x.time ? ` <span class="src">ready by ${esc(depFmt(x.time, { hour: '2-digit', minute: '2-digit' }))}</span>` : '');
    const depLabel = (x) => `${esc(depWhen(leaveOf(x)))} · ${esc(x.soc)}% <span class="chip">${esc(SOURCE_NAMES[x.source])}</span>${x.title ? ` <span class="src">${esc(x.title)}</span>` : ''}${readyBy(x)}`;

    function entityOptions(list, selected, noneLabel) {
      const item = (o) => `<option value="${esc(o.entity_id)}" ${o.entity_id === selected ? 'selected' : ''}>${esc(o.name)} (${esc(o.state)})</option>`;
      const car = list.filter((o) => o.group === 'car');
      const other = list.filter((o) => o.group !== 'car');
      if (!car.length) return `<option value="">${esc(noneLabel)}</option>` + list.map(item).join('');
      return `<option value="">${esc(noneLabel)}</option>` +
        `<optgroup label="From your car">${car.map(item).join('')}</optgroup>` +
        (other.length ? `<optgroup label="Other">${other.map(item).join('')}</optgroup>` : '');
    }

    // Local "YYYY-MM-DDTHH:MM" for a datetime-local input.
    function localInputValue(ms) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: depTz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    }

    let depCar = null; // more cars: the car whose departures are shown

    function depCarHtml(d) {
      if (!d.cars) return '';
      const car = d.cars.find((c) => c.id === d.vehicle_id) || d.cars[0];
      const others = d.cars.filter((c) => c.id !== car.id);
      return `
        <div class="buttons car-picker">${d.cars.map((c) => `<button type="button" class="${c.id === car.id ? 'primary' : 'secondary'}" data-depcar="${esc(c.id)}">${icon('car')}<span>${esc(c.name)}</span></button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="dep-own" ${d.own_departures ? 'checked' : ''}> ${esc(car.name)} has its own departures</label>
        <p class="muted small">${d.own_departures
          ? `The schedule, calendar and one-off departure below are only for ${esc(car.name)}.`
          : `${esc(car.name)} uses the shared departures${others.some((o) => !o.own_departures) ? `, the same as ${others.filter((o) => !o.own_departures).map((o) => esc(o.name)).join(' and ')}` : ''}. Changes below apply to every car that uses them.`}</p>`;
    }

    async function loadDepartures() {
      try {
        const d = await api('GET', depCar ? `api/departures?vehicle=${encodeURIComponent(depCar)}` : 'api/departures');
        depTz = d.time_zone;
        const dep = d.departures;
        if (d.cars) depCar = d.vehicle_id;
        else depCar = null;

        $('dep-next').innerHTML = `
          ${depCarHtml(d)}
          <h2>Next departure${d.cars ? ` · ${esc((d.cars.find((c) => c.id === d.vehicle_id) || {}).name || '')}` : ''}</h2>
          ${d.next ? `<div class="headline">${depLabel(d.next)}</div>` : '<p class="muted">No departure planned. The plan then charges in the cheapest known blocks without a deadline.</p>'}
          ${d.charge_for ? `<div class="note">${shape('flag', 'blue', true)} <strong>The plan uses your choice on <a href="#" data-goto="overview">Home</a> instead:</strong> ready ${esc(depWhen(d.charge_for.until))} at ${esc(d.charge_for.soc)}%. Departures before then get at least ${esc(d.charge_for.min_soc)}%. ${cfOrigin(d.charge_for)} Ends by itself after that time.
            <div style="margin-top:8px"><button class="secondary" id="dep-cf-clear">Back to normal</button></div></div>` : ''}
          ${d.calendar_error ? `<div class="error">Calendar could not be read: ${esc(d.calendar_error)}</div>` : ''}
          ${d.upcoming.length > 1 ? `
          <details><summary class="small muted" style="margin-top:8px;cursor:pointer">Next 7 days</summary>
            <table class="periods">
              ${d.upcoming.map((u) => `<tr><td>${depLabel(u.winner)}${(u.later || []).map((o) => `<div class="small muted">later that day: ${esc(depFmt(leaveOf(o), { hour: '2-digit', minute: '2-digit' }))}${o.title ? ' · ' + esc(o.title) : ''}</div>`).join('')}${u.others.map((o) => `<div class="small strike">${esc(depWhen(leaveOf(o)))} · ${esc(o.soc)}% · ${esc(SOURCE_NAMES[o.source])}</div>`).join('')}</td></tr>`).join('')}
            </table>
            <p class="muted small">The plan prepares the car for the first departure of each day. Crossed out: replaced by a source with higher priority on that day (one-off, then calendar, then helper, then schedule).</p>
          </details>` : ''}`;
        $('dep-next').querySelectorAll('[data-depcar]').forEach((b) => {
          b.onclick = () => { depCar = b.dataset.depcar; $('dep-form').reset(); loadDepartures(); };
        });
        if ($('dep-own')) {
          $('dep-own').onchange = async (e) => {
            try {
              await api('POST', 'api/departures/own', { vehicle_id: depCar, own: e.target.checked });
            } catch (err) {
              alert(err.message);
            }
            loadDepartures();
          };
        }
        if ($('dep-cf-clear')) {
          $('dep-cf-clear').onclick = async () => {
            $('dep-cf-clear').disabled = true;
            await api('DELETE', 'api/chargefor');
            loadDepartures();
          };
        }

        const trips = d.calendar_trips || [];
        $('dep-trips').hidden = !dep.calendar.enabled;
        const nextKey = d.next ? `${d.next.source}:${d.next.time}` : '';
        $('dep-trips').innerHTML = `
          <h2>Trips from your calendar</h2>
          <p class="muted small">Next 14 days${dep.calendar.buffer_minutes ? ` · ready ${esc(dep.calendar.buffer_minutes)} minutes before each trip` : ''}</p>
          ${trips.length ? `<table class="periods">
            <tr><th>Leave</th><th>Trip</th><th class="n">Target</th></tr>
            ${trips.map((t) => `<tr>
              <td>${esc(depWhen(t.event_start))}${nextKey === `calendar:${t.time}` ? ' <span class="chip">next</span>' : ''}${readyBy(t)}</td>
              <td>${esc(t.title)}${t.location ? `<div class="src">${esc(t.location)}</div>` : ''}${t.precondition ? '<div class="src">Precondition: yes</div>' : ''}${t.cost && t.cost.status !== 'unknown' ? `<div class="src">${tripText(t.cost)}</div>` : ''}${d.cars ? (t.car_unknown ? `<div class="src warn-text">Car "${esc(t.car)}" not recognised: counts for every car</div>` : t.car ? `<div class="src">Car: ${esc(t.car)}</div>` : '<div class="src">Every car</div>') : ''}</td>
              <td class="n">${esc(t.soc)}%${t.soc_from_event ? '' : '<div class="src">default</div>'}</td>
            </tr>`).join('')}
          </table>` : `<p class="muted">No trips found in this calendar for the next 14 days${dep.calendar.match === 'target' ? ' (looking for events with "doel: 80" or similar in the description)' : ''}.</p>`}`;

        renderTripForm(d);

        const ov = dep.override && dep.override.time > d.now ? dep.override : null;
        $('dep-override').innerHTML = `
          <h2>One-off departure</h2>
          <p class="muted small">For a trip that differs from normal. It has the highest priority and is removed automatically after it has passed.</p>
          ${ov ? `<div class="row"><span>${esc(depWhen(ov.time))} · ${esc(ov.soc)}%</span><button class="secondary" id="ov-clear">Remove</button></div>` : ''}
          <div class="two">
            <div class="field"><label>Leave at</label><input type="datetime-local" id="ov-time" value="${ov ? localInputValue(ov.time) : ''}"></div>
            <div class="field"><label>Battery level (%)</label><input type="number" id="ov-soc" min="10" max="100" step="1" value="${ov ? ov.soc : 100}"></div>
          </div>
          <div class="buttons"><button class="primary" id="ov-set">${ov ? 'Change' : 'Set one-off departure'}</button></div>
          <div class="error" id="ov-error" hidden></div>`;
        $('ov-set').onclick = async () => {
          try {
            await api('POST', 'api/departures/override', { datetime: $('ov-time').value, soc: $('ov-soc').value, vehicle_id: depCar });
            loadDepartures();
          } catch (err) {
            $('ov-error').textContent = err.message;
            $('ov-error').hidden = false;
          }
        };
        if (ov) $('ov-clear').onclick = async () => { await api('DELETE', depCar ? `api/departures/override?vehicle=${encodeURIComponent(depCar)}` : 'api/departures/override'); loadDepartures(); };

        const f = $('dep-form');
        if (document.activeElement.form === f && f.dataset.car === String(depCar)) return; // don't overwrite while editing
        f.dataset.car = String(depCar);
        f.schedule_enabled.checked = dep.schedule_enabled;
        f.default_soc.value = dep.default_soc;
        $('dep-days').innerHTML = DAY_KEYS.map((k) => `
          <tr><td>${DAY_NAMES[k]}</td>
            <td><input type="checkbox" name="${k}_on" ${dep.schedule[k].enabled ? 'checked' : ''}></td>
            <td><input type="time" name="${k}_time" value="${esc(dep.schedule[k].time)}"></td>
            <td class="n"><input type="number" name="${k}_soc" min="10" max="100" step="1" value="${esc(dep.schedule[k].soc)}" style="width:80px"></td></tr>`).join('');
        f.helper_enabled.checked = dep.helper.enabled;
        f.helper_datetime.innerHTML = entityOptions(d.options.input_datetime, dep.helper.datetime_entity, '— choose —');
        f.helper_soc.innerHTML = entityOptions(d.options.input_number, dep.helper.soc_entity, '— none: use the default level —');
        f.cal_enabled.checked = dep.calendar.enabled;
        f.cal_entity.innerHTML = entityOptions(d.options.calendar, dep.calendar.entity, '— choose —');
        f.cal_match.value = dep.calendar.match || 'target';
        f.cal_keyword.value = dep.calendar.keyword;
        $('cal-keyword-field').hidden = f.cal_match.value !== 'keyword';
        f.cal_buffer.value = dep.calendar.buffer_minutes;
        f.cal_soc.value = dep.calendar.soc;
      } catch (err) {
        $('dep-next').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    }

    $('dep-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const errBox = f.querySelector('.form-error');
      const btn = f.querySelector('button[type=submit]');
      errBox.hidden = true;
      const schedule = {};
      for (const k of DAY_KEYS) {
        schedule[k] = { enabled: f[`${k}_on`].checked, time: f[`${k}_time`].value, soc: f[`${k}_soc`].value };
      }
      const body = {
        vehicle_id: depCar,
        schedule_enabled: f.schedule_enabled.checked,
        schedule,
        default_soc: f.default_soc.value,
        helper: { enabled: f.helper_enabled.checked, datetime_entity: f.helper_datetime.value, soc_entity: f.helper_soc.value },
        calendar: {
          enabled: f.cal_enabled.checked, entity: f.cal_entity.value, match: f.cal_match.value, keyword: f.cal_keyword.value,
          buffer_minutes: f.cal_buffer.value, soc: f.cal_soc.value,
        },
      };
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await api('POST', 'api/departures', body);
        document.activeElement.blur();
        await loadDepartures();
        btn.textContent = 'Saved ✓';
        $('dep-next').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.textContent = 'Save departures';
      } finally {
        setTimeout(() => { btn.textContent = 'Save departures'; btn.disabled = false; }, 2000);
      }
    });

    // ---------- Savings ----------
    async function loadSavings() {
      const box = $('savings-body');
      box.innerHTML = '<div class="card muted">Collecting charging sessions and prices… this can take a moment the first time.</div>';
      try {
        const d = await api('GET', 'api/savings');
        const cur = (v) => {
          if (v == null) return '–';
          try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: d.currency || 'EUR' }).format(v); } catch { return v.toFixed(2); }
        };
        const when = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: d.time_zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
        if (!d.available) {
          const why = {
            no_charger_power: 'Choose a charging power sensor on the <a href="#" data-goto="charger">Charger</a> tab, for example a separate kWh meter. The app uses its history to find charging sessions.',
            no_prices: 'Set up a price source on the <a href="#" data-goto="prices">Prices</a> tab first.',
          }[d.reason] || esc(d.reason);
          box.innerHTML = `<div class="card"><h2>Savings</h2><p class="muted">${why}</p></div>`;
          return;
        }
        const t = d.totals;
        const saved = t.direct_cost - t.actual_cost;
        const extra = t.actual_cost - t.plan_cost;
        box.innerHTML = `
          <div class="card">
            <span class="advice">LAST ${d.days} DAYS · ESTIMATE PER HOUR</span>
            ${t.sessions ? `
            <div class="headline">${t.energy_kwh.toFixed(0)} kWh charged in ${t.sessions} session${t.sessions > 1 ? 's' : ''}</div>
            <div class="stats">
              <div class="stat"><div class="v">${cur(t.actual_cost)}</div><div class="l">Actually paid</div></div>
              <div class="stat"><div class="v">${cur(t.direct_cost)}</div><div class="l">Charging right away</div></div>
              <div class="stat"><div class="v">${cur(t.plan_cost)}</div><div class="l">With the plan</div></div>
            </div>
            <p class="muted small">Your current way of charging ${saved >= 0 ? `saved <strong>${cur(saved)}</strong> compared with` : `cost <strong>${cur(-saved)}</strong> more than`} charging right away.
              The plan would have saved another <strong>${cur(Math.max(0, extra))}</strong>.</p>` : '<p class="muted">No complete charging sessions found yet.</p>'}
            ${d.incomplete ? `<div class="note">${d.incomplete} session${d.incomplete > 1 ? 's' : ''} left out: prices for those hours are not known. The app stores prices from now on; integrations like EnergyZero and Nord Pool can also look back.</div>` : ''}
            ${d.plugged_source ? '' : '<div class="note">No plugged-in sensor in Settings › Vehicle, so each session is compared within the hours it was actually charging. With a plugged-in sensor the comparison uses the whole time the car was connected, which shows the real difference with charging right away.</div>'}
          </div>
          ${d.sessions.length ? `
          <div class="card">
            <h2>Charging sessions</h2>
            <table class="periods">
              <tr><th>Charging started</th><th class="n">Energy</th><th class="n">Paid</th><th class="n">Right away</th><th class="n">Plan</th></tr>
              ${d.sessions.map((x) => `<tr>
                <td>${esc(when(x.start))}${x.plugged_from ? `<div class="src">plugged in ${esc(when(x.plugged_from))}</div>` : ''}</td>
                <td class="n">${x.energy_kwh.toFixed(1)} kWh</td>
                ${x.complete ? `<td class="n">${cur(x.actual_cost)}</td><td class="n">${cur(x.direct_cost)}</td><td class="n">${cur(x.plan_cost)}</td>`
                  : '<td class="n muted" colspan="3">prices unknown</td>'}
              </tr>`).join('')}
            </table>
            <p class="muted small">"Right away": the same energy charged from the moment the car was plugged in. "Plan": the same energy in the cheapest hours while plugged in. Prices include your purchase fee, energy tax and VAT as set in Settings › Prices.</p>
          </div>` : ''}`;
      } catch (err) {
        box.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    // ---------- Control check ----------
    const WARN_TEXT = {
      own_smart_charging_on: (w) => `"${esc(w.name)}" is on. The charger's own smart charging would fight with the app; turn it off before letting the app control charging.`,
      no_start_stop: () => 'No way found to start and stop charging.',
      no_current: () => 'No way found to set the charging current. The app can still start and stop.',
      blunt_switch: (w) => `The best start/stop option is the switch ${esc(w.entity_id)}, which may turn the whole charger off. Pausing through an action would be better.`,
      no_device: () => 'The charger was chosen manually and has no device, so the integration\'s actions cannot be matched.',
      own_mode_on: (w) => `"${esc(w.name)}" is set to "${esc(w.state)}". The charger's own smart or solar mode would fight with the app; set it to its normal or default mode before letting the app control charging.`,
      read_only_integration: (w) => `The ${esc(w.integration)} integration can only read data; it cannot start or stop charging. The app can plan and advise, but not control this charger.`,
      alfen_single_login: () => 'Alfen allows only one login at a time: the Alfen app (MyEve / Eve Connect) and Home Assistant push each other out. Use the integration\'s login/logout buttons when you need the Alfen app.',
      ocpp_backend: () => 'OCPP: the charger must be set to connect to Home Assistant (ws://&lt;HA&gt;:9000/&lt;id&gt;). Use the "Charge control" switch for start/stop, not the availability switches.',
    };

    function methodText(m) {
      if (!m) return '<span class="muted">none</span>';
      switch (m.type) {
        case 'action_choice': return `Action <code>${esc(m.domain)}.${esc(m.service)}</code> with ${esc(m.field)}: <strong>${esc(m.start_value)}</strong> / <strong>${esc(m.stop_value)}</strong>`;
        case 'action_pair': return `Actions <code>${esc(m.domain)}.${esc(m.start_service)}</code> / <code>${esc(m.stop_service)}</code>`;
        case 'buttons': return `Buttons <code>${esc(m.start_entity)}</code> / <code>${esc(m.stop_entity)}</code>`;
        case 'switch': return `Switch <code>${esc(m.entity_id)}</code>${m.blunt ? ' <span class="src">(turns the charger on/off)</span>' : ''}`;
        case 'action_current': return `Action <code>${esc(m.domain)}.${esc(m.service)}</code>, field ${esc(m.field)}${m.max != null ? ` (${esc(m.min ?? 0)}–${esc(m.max)} A)` : ''}${m.dynamic ? ' <span class="src">temporary limit</span>' : ''}${m.ttl_field ? ' <span class="src">expires by itself</span>' : ''}`;
        case 'number': return `Entity <code>${esc(m.entity_id)}</code>${m.max != null ? ` (${esc(m.min ?? 0)}–${esc(m.max)} A)` : ''}`;
        default: return esc(m.type);
      }
    }

    async function runControlCheck() {
      const box = $('control-result');
      box.innerHTML = '<p class="muted small">Checking…</p>';
      try {
        const r = await api('GET', 'api/control/check');
        if (!r.available) {
          box.innerHTML = r.reason === 'not_a_charger'
            ? '<div class="note">This device is not recognised as an EV charger, so the app will not control it. Choose your charger with "Detect chargers".</div>'
            : '<p class="muted">Set up a charger first.</p>';
          return;
        }
        const alt = (list, rec) => list.filter((m) => m !== list[0]).map((m) => `<div class="small muted">or: ${methodText(m)}</div>`).join('');
        box.innerHTML = `
          <table class="periods" style="margin-top:12px">
            <tr><th>What</th><th>The app would use</th></tr>
            <tr><td>Start / stop</td><td>${methodText(r.recommended.start_stop)}${alt(r.start_stop)}</td></tr>
            <tr><td>Charging current</td><td>${methodText(r.recommended.current)}${alt(r.current)}</td></tr>
          </table>
          <p class="muted small">Integration: ${esc(r.domains.join(', ') || 'unknown')} · Control is ${r.control_allowed ? '<strong>allowed</strong>' : 'off'} · nothing was sent.</p>
          ${r.warnings.map((w) => `<div class="note">${(WARN_TEXT[w.code] || (() => esc(w.code)))(w)}</div>`).join('')}`;
      } catch (err) {
        box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    }

    // ---------- Control (dry run) ----------
    function wantText(e) {
      if (!e) return 'No decision yet';
      switch (e.want) {
        case 'charge': return e.manual || e.live ? 'Charge' : `Charge at ${e.amps} A`;
        case 'pause': return 'Pause charging';
        case 'leave': return 'Leave the charger alone';
        default: return 'Nothing to do';
      }
    }
    function actualText(e) {
      if (e.plugged === false) return 'not plugged in';
      if (e.charging === true) return `charging${e.power_w != null ? ` (${tidy(e.power_w / 1000)} kW)` : ''}`;
      if (e.charging === false) return `plugged in, not charging${e.status ? ` (${e.status})` : ''}`;
      return e.status || 'unknown';
    }
    function cmdText(c) {
      const target = c.target ? ` → ${Object.values(c.target)[0]}` : '';
      return `${esc(c.what)}: <span class="cmd">${esc(c.service)} ${esc(JSON.stringify(c.data))}${esc(target)}</span>`;
    }

    function methodLabel(m) {
      switch (m.type) {
        case 'action_choice': return `${m.domain}.${m.service}: ${m.start_value} / ${m.stop_value}`;
        case 'action_pair': return `${m.domain}.${m.start_service} / ${m.stop_service}`;
        case 'buttons': return `Buttons ${m.start_entity} / ${m.stop_entity}`;
        case 'switch': return `Switch ${m.entity_id}${m.blunt ? ' (turns the charger on/off)' : ''}`;
        case 'select': return `Choice ${m.entity_id}: ${m.start_option} / ${m.stop_option}${m.blunt ? ' (takes the socket out of service)' : ''}`;
        case 'action_current': return `${m.domain}.${m.service} (${m.field})${m.ttl_field ? ', expires by itself' : ''}`;
        case 'number': return `Entity ${m.entity_id}`;
        default: return m.id;
      }
    }

    function fillControlForm(d) {
      const f = $('control-form');
      if (document.activeElement.form === f) return;
      const r = d.rules;
      const m = d.methods;
      const opts = (list, chosen, rec, noneLabel) => (noneLabel ? `<option value="none" ${chosen === 'none' ? 'selected' : ''}>${esc(noneLabel)}</option>` : '') +
        list.map((x) => `<option value="${esc(x.id)}" ${(chosen || rec) === x.id ? 'selected' : ''}>${esc(methodLabel(x))}${x.id === rec ? ' (recommended)' : ''}</option>`).join('');
      f.start_stop_id.innerHTML = m && m.start_stop.length ? opts(m.start_stop, r.start_stop_id, m.recommended.start_stop) : '<option value="">None found (run the control check in Settings › Charger)</option>';
      f.current_id.innerHTML = m ? opts(m.current, r.current_id, m.recommended.current, "Don't set the current") : '<option value="">None found</option>';
      f.min_soc_enabled.checked = !!r.min_soc_enabled;
      f.min_soc.value = r.min_soc;
      f.min_soc_entity.innerHTML = entityOptions(d.options.min_soc, r.min_soc_entity, '— use the number above —');
      f.min_soc_max_price.value = r.min_soc_max_price ?? '';
      f.preheat_entity.innerHTML = entityOptions(d.options.preheat, r.preheat_entity, '— none —');
      f.force_minutes.value = r.force_minutes;
      f.hysteresis.value = r.hysteresis;
      f.ready_guard_enabled.checked = r.ready_guard_enabled !== false;
      f.ready_guard_margin_minutes.value = r.ready_guard_margin_minutes ?? 30;
      f.battery_care_enabled.checked = r.battery_care_enabled !== false;
      f.battery_care_soc.value = r.battery_care_soc ?? 80;
      f.battery_care_hours.value = r.battery_care_hours ?? 4;
      f.car_limit_off.checked = !!r.car_limit_off;
      f.min_choice.value = r.min_choice ?? 30;
      const lim = d.car_limit;
      $('car-limit-now').innerHTML = lim && lim.entity_id
        ? `Car limit now: <strong>${lim.value != null ? esc(lim.value) + '%' : 'unknown'}</strong> (${esc(lim.name)})${lim.writable ? '' : ' · <span class="differ">your car does not allow changing it from Home Assistant; set it in the car</span>'}${d.control_allowed ? '' : ' · <span class="differ">follows your choices once "Allow control" is on</span>'}`
        : '<span class="differ">No charge limit of the car found. Choose it in Settings › Vehicle.</span>';
      syncSubs(f);
    }

    // Show the fields under a checkbox only when it is on.
    function syncSubs(f) {
      f.querySelectorAll('.sub[data-when]').forEach((el) => { el.hidden = !f[el.dataset.when].checked; });
    }

    $('control-form').addEventListener('change', (e) => { if (e.target.type === 'checkbox') syncSubs(e.currentTarget); });

    $('control-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const errBox = f.querySelector('.form-error');
      const btn = f.querySelector('button[type=submit]');
      errBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await api('POST', 'api/control/settings', {
          start_stop_id: f.start_stop_id.value, current_id: f.current_id.value,
          min_soc_enabled: f.min_soc_enabled.checked, min_soc: f.min_soc.value, min_soc_entity: f.min_soc_entity.value,
          min_soc_max_price: f.min_soc_max_price.value, preheat_entity: f.preheat_entity.value,
          force_minutes: f.force_minutes.value, hysteresis: f.hysteresis.value,
          ready_guard_enabled: f.ready_guard_enabled.checked,
          ready_guard_margin_minutes: f.ready_guard_margin_minutes.value,
          battery_care_enabled: f.battery_care_enabled.checked,
          battery_care_soc: f.battery_care_soc.value,
          battery_care_hours: f.battery_care_hours.value,
          car_limit_off: f.car_limit_off.checked, min_choice: f.min_choice.value,
        });
        document.activeElement.blur();
        await loadControl();
        btn.textContent = 'Saved ✓';
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.textContent = 'Save rules';
      } finally {
        setTimeout(() => { btn.textContent = 'Save rules'; btn.disabled = false; }, 2000);
      }
    });

    // Automations that may fight with the app.
    function conflictsHtml(r) {
      const active = (r.items || []).filter((x) => !x.dismissed);
      const ignored = (r.items || []).filter((x) => x.dismissed);
      if (!active.length && !ignored.length) return '';
      const row = (x) => `<div class="row" style="align-items:center">
          <span><strong>${esc(x.name)}</strong><div class="src">${esc(x.entity_id)} · uses ${esc(x.uses.join(' and '))}${x.via.length ? ` (through ${esc(x.via.join(', '))})` : ''}</div></span>
          <button class="secondary conflict-dismiss" data-id="${esc(x.entity_id)}" data-undo="${x.dismissed ? '1' : ''}">${x.dismissed ? 'Warn again' : 'Ignore'}</button>
        </div>`;
      return `<div class="card">
          ${active.length ? `<h2>${shape('alert', 'orange', true)} Possible conflicts</h2>
          <p class="muted small">These automations are on and use the same charger or car limit as the app. When "Allow control" is on, they may undo what the app does. Turn them off in Settings → Automations if the app takes over their job. The app never turns them off itself. Home Assistant only says that an automation <em>uses</em> the entity, not that it changes it; select Ignore if it is harmless (for example a notification).</p>
          ${active.map(row).join('')}` : ''}
          ${ignored.length ? `<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Ignored (${ignored.length})</summary>${ignored.map(row).join('')}</details>` : ''}
        </div>`;
    }

    async function loadConflicts(refresh = false) {
      try {
        const r = await api('GET', refresh ? 'api/conflicts?refresh=1' : 'api/conflicts');
        const html = conflictsHtml(r);
        $('conflicts-log').innerHTML = html;
        $('conflicts-ctl').innerHTML = html;
        document.querySelectorAll('.conflict-dismiss').forEach((btn) => {
          btn.onclick = async () => {
            btn.disabled = true;
            await api('POST', 'api/conflicts/dismiss', { entity_id: btn.dataset.id, undo: btn.dataset.undo === '1' });
            loadConflicts();
          };
        });
      } catch {
        // no warning card when the check fails
      }
    }

    async function loadControl() {
      loadConflicts();
      const box = $('control-body');
      try {
        const d = await api('GET', 'api/control');
        fillControlForm(d);
        const t = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: d.time_zone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
        const n = d.now;
        if (!n) {
          box.innerHTML = '<div class="card"><h2>Control</h2><p class="muted">Set up a charger and a plan first. The dry run starts with the next refresh.</p></div>';
          return;
        }
        $('manual-test-body').innerHTML = `          <div class="card">
            <h2>${shape('control', 'grey', true)} Manual test</h2>
            <p class="muted small">Start or stop the charger once with the start/stop method chosen in Settings › Charger${d.chosen_start_stop ? ` (<span class="cmd">${esc(d.chosen_start_stop)}</span>)` : ''}. Use this to check that the app can really control your charger. With Allow control on, the plan takes over again at the next check (within a minute); to charge now, use Charge now on Home.</p>
            ${d.control_allowed
              ? '<div style="display:flex;gap:8px"><button class="primary" id="manual-start">Start charging</button><button class="secondary" id="manual-stop">Stop charging</button></div>'
              : '<div class="note">Allow control is off in the app\'s Configuration tab, so these buttons are hidden and nothing can be sent.</div>'}
            <div id="manual-result"></div>
          </div>`;
        box.innerHTML = `
          <div class="card">
            ${d.control_allowed ? '<span class="advice live">LIVE · THE APP CONTROLS THE CHARGER</span>' : '<span class="advice test">DRY RUN · NOTHING IS SENT</span>'}
            <div class="entity" style="margin:12px 0 4px">
              ${n.want === 'charge' ? shape('bolt', 'green') : n.want === 'pause' ? shape('pause', 'amber') : shape('sleep', 'grey')}
              <div class="txt"><div class="headline">Right now the app ${d.control_allowed ? 'wants to' : 'would'}: ${esc(wantText(n))}</div></div>
            </div>
            <p class="muted small">${esc(n.reason)}${n.block_end ? ` until ${esc(t(n.block_end))}` : ''}${n.next_start ? ` · next planned start ${esc(t(n.next_start))}` : ''}${n.locked_until ? ` · period locked until ${esc(t(n.locked_until))}` : ''}</p>
            <div class="row"><span class="label">Charger now</span><span class="value">${esc(actualText(n))}</span></div>
            <div class="row"><span class="label">Same as the plan?</span><span class="value">${n.agrees ? '<span class="agree">Yes</span>' : '<span class="differ">No — the app would change this</span>'}</span></div>
            <div class="row"><span class="label">${d.control_allowed ? 'Sends' : 'Would send'}</span><span class="value">${n.commands.length ? n.commands.map(cmdText).join('<br>') : '<span class="muted">nothing</span>'}${n.waiting ? '<div class="src">Already sent less than 15 minutes ago; waiting for the charger before sending again.</div>' : ''}${n.error ? `<div class="src differ">${esc(n.error)}</div>` : ''}</span></div>
            <p class="muted small">Checked every ${lastPlan ? esc(lastPlan.refresh_minutes) : '?'} minutes in the background. Only changes are logged below. ${d.control_allowed ? 'Allow control is on: the app starts and pauses the charger by itself, following the plan, Charge now and the rules in Settings › Rules. The charger is also checked every minute in between. Only start/stop is sent; the charging current (and phases) only when charging on solar (Settings › Solar). Turn off your own charging automation, or the two will fight.' : 'Allow control is off: nothing is sent. Turn it on in the app\'s Configuration tab to let the app control the charger.'}</p>
          </div>
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <h2 style="margin:0">Log</h2>
              ${d.log.length ? '<button class="secondary" id="log-clear">Clear log</button>' : ''}
            </div>
            <p class="muted small">What the app wanted, and every command that was really sent (SENT) or could not be sent (Not sent). Keeps the last 500 lines.</p>
            ${d.log.length ? `<table class="periods">
              <tr><th>Time</th><th>The app wanted</th><th>Charger was</th></tr>
              ${d.log.map((e) => `<tr>
                <td>${esc(t(e.time))}</td>
                <td>${e.manual || (e.live && (e.sent || e.error)) ? `<strong>${e.sent ? 'SENT' : 'Not sent'}</strong> · ` : ''}${esc(wantText(e))}<div class="src">${esc(e.reason)}</div>${e.commands.map((c) => `<div class="src">${esc(c.what)}${e.manual || e.sent ? `: ${esc(c.service)}` : ''}</div>`).join('')}${e.error ? `<div class="src differ">${esc(e.error)}</div>` : ''}</td>
                <td>${esc(actualText(e))}<div class="small ${e.agrees ? 'agree' : 'differ'}">${e.agrees ? 'same' : 'different'}</div></td>
              </tr>`).join('')}
            </table>` : '<p class="muted">Nothing logged yet.</p>'}
          </div>`;
        const lc = $('log-clear');
        if (lc) lc.onclick = async () => {
          if (lc.dataset.confirm !== '1') {
            lc.dataset.confirm = '1';
            lc.textContent = 'Click again to clear';
            setTimeout(() => { if (lc.isConnected) { lc.dataset.confirm = ''; lc.textContent = 'Clear log'; } }, 4000);
            return;
          }
          lc.disabled = true;
          await api('DELETE', 'api/control/log');
          loadControl();
        };
        for (const [id, action] of [['manual-start', 'start'], ['manual-stop', 'stop']]) {
          const btn = $(id);
          if (btn) btn.onclick = async () => {
            btn.disabled = true;
            const out = $('manual-result');
            out.innerHTML = '<p class="muted small">Sending…</p>';
            try {
              const r = await api('POST', 'api/control/manual', { action });
              out.innerHTML = sendHtml(r, action === 'start' ? 'Start' : 'Stop') + '<p class="muted small">The charger status is read again at the next refresh; check the charger or its app to see the result.</p>';
            } catch (err) {
              out.innerHTML = `<div class="error">${esc(err.message)}</div>`;
            }
            btn.disabled = false;
          };
        }
      } catch (err) {
        box.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    // ---------- Add trip ----------
    let tripWriteAllowed = false;

    function renderTripForm(d) {
      const f = $('trip-form');
      f.hidden = !d.departures.calendar.enabled || !d.departures.calendar.entity;
      tripWriteAllowed = !!d.calendar_write_allowed;
      $('trip-mode').textContent = tripWriteAllowed ? 'WRITES TO CALENDAR' : 'TEST MODE';
      $('trip-mode').className = tripWriteAllowed ? 'advice' : 'advice test';
      $('trip-mode-text').innerHTML = tripWriteAllowed
        ? `Trips are added to <strong>${esc(d.departures.calendar.entity)}</strong> as "Naar &lt;destination&gt;" with "doel: … precondition: …"${d.cars ? ' and "auto: …"' : ''}, the same format this app reads.`
        : `Nothing is written: you see which events would be added. To add them for real, turn on <strong>Allow adding trips to calendar</strong> in the app's Configuration tab.`;
      $('trip-add').hidden = !tripWriteAllowed;
      // More cars: which car the trip is for ("auto: …" in the event), or every car.
      const carField = $('trip-car-field');
      carField.hidden = !d.cars;
      if (d.cars) {
        const cur = f.trip_car.value;
        f.trip_car.innerHTML = d.cars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') + '<option value="all">Every car</option>';
        f.trip_car.value = cur && [...f.trip_car.options].some((o) => o.value === cur) ? cur : d.vehicle_id;
      }
      $('trip-preview').textContent = tripWriteAllowed ? 'Preview' : 'Show what would be added';
      $('trip-preview').className = tripWriteAllowed ? 'secondary' : 'primary';
      const days = f.querySelector('.days');
      if (!days.children.length) {
        days.innerHTML = DAY_KEYS.map((k) => `<label><input type="checkbox" name="rep_${k}"> ${DAY_NAMES[k].slice(0, 2)}</label>`).join('');
        days.addEventListener('change', () => {
          $('trip-weeks-field').hidden = !DAY_KEYS.some((k) => f[`rep_${k}`].checked);
        });
      }
    }

    function tripBody() {
      const f = $('trip-form');
      const forCar = !$('trip-car-field').hidden ? f.trip_car.value : null;
      return {
        vehicle_id: forCar && forCar !== 'all' ? forCar : depCar,
        for_all_cars: forCar === 'all',
        datetime: f.datetime.value,
        destination: f.destination.value,
        soc: f.soc.value,
        precondition: f.precondition.checked,
        weekdays: DAY_KEYS.filter((k) => f[`rep_${k}`].checked),
        weeks: f.weeks.value,
      };
    }

    function tripTable(r) {
      const rows = r.events.map((e) => `<tr>
        <td>${esc(depWhen(e.start))}</td>
        <td>${esc(e.summary)}<div class="src">${esc(e.description)}</div></td>
        <td class="n">${e.duplicate ? '<span class="muted small">already in calendar</span>' : 'new'}</td></tr>`).join('');
      return `<table class="periods"><tr><th>Leave</th><th>Event</th><th class="n"></th></tr>${rows}</table>`;
    }

    async function tripSend(add) {
      const f = $('trip-form');
      const errBox = f.querySelector('.form-error');
      errBox.hidden = true;
      if (!f.reportValidity()) return;
      try {
        if (!add) {
          const r = await api('POST', 'api/trips/preview', tripBody());
          const n = r.events.filter((e) => !e.duplicate).length;
          $('trip-result').innerHTML = `<p class="small" style="margin-top:12px"><strong>${n} event${n === 1 ? '' : 's'}</strong> ${r.write_allowed ? 'will be added' : 'would be added (test mode, nothing written)'}:</p>${tripTable(r)}`;
          return;
        }
        if (!confirm('Add these trips to your calendar?')) return;
        const r = await api('POST', 'api/trips', tripBody());
        $('trip-result').innerHTML = `<p class="ok" style="margin-top:12px">Added ${r.created} trip${r.created === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already in the calendar` : ''}.</p>`;
        loadDepartures();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    }

    $('trip-preview').addEventListener('click', () => tripSend(false));
    $('trip-form').addEventListener('submit', (e) => { e.preventDefault(); tripSend(true); });

    $('dep-form').cal_match.addEventListener('change', (e) => {
      $('cal-keyword-field').hidden = e.target.value !== 'keyword';
    });

    // Links like <a data-goto="departures"> switch tabs.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-goto]');
      if (!a) return;
      e.preventDefault();
      showTab(a.dataset.goto);
    });

    // ---------- Prices ----------
    let priceSources = [];
    let priceTz = 'UTC';

    const fmtPrice = (v) => (v == null ? '–' : `${Number(v).toFixed(4)} /kWh`);
    const fmtTime = (ms) => new Intl.DateTimeFormat('en-GB', {
      timeZone: priceTz, weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));

    function forecastHtml(f) {
      if (!f) return '';
      const row = (label, value) => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${value}</span></div>`;
      if (f.error) return row('Forecast', `<span class="fail">${esc(f.error)}</span>`);
      if (!f.count) return row('Forecast', '<span class="muted">No forecast prices after the real prices</span>');
      return `
        ${row('Forecast', `<span class="ok">${f.count}</span> prices, ${esc(fmtTime(f.from))} – ${esc(fmtTime(f.until))}`)}
        ${row('Forecast average (all-in)', `${fmtPrice(f.average)} <span class="muted small">+ margin ${Number(f.margin).toFixed(3)}</span>`)}
        ${row('Forecast lowest', f.lowest ? `${fmtPrice(f.lowest.total)} <span class="muted small">at ${esc(fmtTime(f.lowest.start))}</span>` : '–')}
        ${(f.warnings || []).map((w) => `<div class="note">${esc(w)}</div>`).join('')}`;
    }

    function summaryHtml(s) {
      const row = (label, value) => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${value}</span></div>`;
      const at = (p) => (p ? `${fmtPrice(p.total)} <span class="muted small">at ${esc(fmtTime(p.start))}</span>` : '–');
      return `
        ${row('Price now (all-in)', s.current ? `<strong>${fmtPrice(s.current.total)}</strong> <span class="muted small">source: ${Number(s.current.price).toFixed(4)}</span>` : '<span class="fail">No price for now</span>')}
        ${row('Interval', `${s.interval_minutes} minutes`)}
        ${row('Prices today', String(s.count_today))}
        ${row('Prices tomorrow', s.tomorrow_available ? `<span class="ok">${s.count_tomorrow}</span>` : '<span class="muted">Not yet published (usually around 13:00)</span>')}
        ${row('Lowest today', at(s.lowest_today))}
        ${row('Highest today', at(s.highest_today))}
        ${row('Average today', fmtPrice(s.average_today))}
        ${s.warnings.map((w) => `<div class="note">${esc(w)}</div>`).join('')}`;
    }

    function priceFormData() {
      const form = $('prices-form');
      const data = Object.fromEntries(new FormData(form));
      const src = priceSources.find((c) => c.id === data.source);
      delete data.source;
      if (src && src.type === 'fixed') {
        return {
          source: src,
          fixed: {
            mode: form.fx_mode.value, normal: form.fx_normal.value, low: form.fx_low.value,
            low_from: form.fx_low_from.value, low_to: form.fx_low_to.value, weekend_low: form.fx_weekend_low.checked,
          },
        };
      }
      return { ...data, source: src };
    }

    // Show the tariff form for a fixed tariff, the cost fields otherwise.
    function syncFixed() {
      const src = priceSources.find((c) => c.id === $('prices-source').value);
      const fixed = !!src && src.type === 'fixed';
      const f = $('prices-form');
      $('fixed-card').hidden = !fixed;
      $('price-costs').hidden = fixed;
      $('forecast-card').hidden = fixed;
      syncForecast();
      const dn = f.fx_mode.value === 'day_night';
      f.querySelectorAll('.fx-dn').forEach((el) => { el.hidden = !dn; });
      $('fx-normal-label').textContent = dn ? 'Normal (day) price per kWh' : 'Price per kWh';
      $('fx-note').textContent = dn
        ? 'The plan charges in the low tariff hours before your departure, as much as fits.'
        : 'With one price all day, the plan cannot save money: it charges right away, so the car is ready as soon as possible. Departures, the car\'s limit, Charge now and notifications all work as usual.';
    }

    // The forecast list: attribute sensors, the ones with more than two days first.
    function fillForecast(selected) {
      const list = priceSources.filter((c) => c.type === 'attribute')
        .sort((a, b) => (b.forecast_capable ? 1 : 0) - (a.forecast_capable ? 1 : 0));
      $('forecast-entity').innerHTML = '<option value="">No forecast</option>' + list.map((c) =>
        `<option value="${esc(c.entity_id)}">${esc(c.name)}${c.forecast_capable ? ' – more than 2 days' : ''}</option>`).join('');
      if (selected && list.some((c) => c.entity_id === selected)) $('forecast-entity').value = selected;
      syncForecast();
    }

    function syncForecast() {
      const f = $('prices-form');
      const id = f.forecast_entity.value;
      f.querySelectorAll('.fc-on').forEach((el) => { el.hidden = !id; });
      const c = priceSources.find((x) => x.entity_id === id);
      $('forecast-detail').textContent = c
        ? `${c.detail}${c.forecast_capable ? '' : ' · this sensor does not seem to have prices after tomorrow'}${c.forecast_marked ? ' · only the hours after the last real price are used' : ''}`
        : '';
    }

    function showSourceDetail() {
      const src = priceSources.find((c) => c.id === $('prices-source').value);
      if (!src) return;
      $('prices-source-detail').textContent = src.type === 'fixed'
        ? 'For contracts without dynamic prices.'
        : src.type === 'action'
          ? `Integration action · ${src.domain}${src.detail ? ' · ' + src.detail : ''}`
          : `Sensor attributes · ${src.detail}`;
      $('prices-form').price_type.value = src.price_type;
      $('prices-form').forecast_price_type.value = src.price_type;
      syncFixed();
    }

    async function detectPrices(preselect) {
      const btn = $('prices-detect');
      btn.disabled = true;
      btn.textContent = 'Searching…';
      $('prices-error').hidden = true;
      try {
        const { candidates } = await api('GET', 'api/prices/detect');
        priceSources = candidates;
        if (!candidates.some((c) => c.type !== 'fixed')) {
          $('prices-error').textContent = 'No dynamic price integration found. With a dynamic contract, install one such as EnergyZero (no account needed) and detect again. Otherwise choose "Fixed or day/night tariff".';
          $('prices-error').hidden = false;
        }
        $('prices-source').innerHTML = candidates.map((c) =>
          `<option value="${esc(c.id)}">${esc(c.name)}${c.detail && c.type === 'action' && c.detail !== c.name ? ' – ' + esc(c.detail) : ''}${c.type === 'attribute' ? ' (sensor)' : ''}</option>`).join('');
        $('prices-form').hidden = false;
        fillForecast(preselect && preselect.forecast ? preselect.forecast.entity_id : '');
        if (preselect && preselect.forecast) {
          $('prices-form').forecast_price_type.value = preselect.forecast.price_type;
          $('prices-form').forecast_margin.value = preselect.forecast.margin;
        }
        if (preselect) {
          if (!candidates.some((c) => c.id === preselect.source.id)) {
            // Not found now (renamed, offline): keep it as an option, so it is not lost.
            priceSources.push(preselect.source);
            $('prices-source').insertAdjacentHTML('afterbegin', `<option value="${esc(preselect.source.id)}">${esc(preselect.source.name)} (saved)</option>`);
          }
          $('prices-source').value = preselect.source.id;
          const f = $('prices-form');
          f.price_type.value = preselect.price_type;
          // 0 is a real value; an empty field would show the grey example instead.
          f.purchase_fee.value = preselect.purchase_fee ?? '';
          f.energy_tax.value = preselect.energy_tax ?? '';
          f.vat_percent.value = preselect.vat_percent;
          if (preselect.source.type === 'fixed') {
            const x = preselect.source;
            f.fx_mode.value = x.mode;
            f.fx_normal.value = x.normal;
            if (x.mode === 'day_night') {
              f.fx_low.value = x.low;
              f.fx_low_from.value = x.low_from;
              f.fx_low_to.value = x.low_to;
              f.fx_weekend_low.checked = !!x.weekend_low;
            }
          }
          $('prices-source-detail').textContent = '';
          syncFixed();
        } else {
          showSourceDetail();
        }
        $('prices-test-result').innerHTML = '';
      } catch (err) {
        $('prices-error').textContent = err.message;
        $('prices-error').hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Detect again';
      }
    }

    async function testPrices() {
      const box = $('prices-test-result');
      const btn = $('prices-test');
      btn.disabled = true;
      btn.textContent = 'Fetching prices…';
      try {
        const r = await api('POST', 'api/prices/test', priceFormData());
        priceTz = r.time_zone;
        box.innerHTML = `<div class="card"><h2>Test result</h2>${summaryHtml(r.summary)}${forecastHtml(r.forecast)}</div>`;
      } catch (err) {
        box.innerHTML = `<div class="card"><h2>Test result</h2><div class="error">${esc(err.message)}</div></div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test';
      }
    }

    async function savePrices(e) {
      e.preventDefault();
      const errBox = $('fixed-card').hidden ? $('price-costs').querySelector('.form-error') : $('fixed-card').querySelector('.form-error');
      errBox.hidden = true;
      try {
        await api('POST', 'api/prices', priceFormData());
        await loadPrices();
        const btns = e.submitter && e.submitter.closest('.buttons');
        if (btns) {
          const ok = document.createElement('p');
          ok.className = 'ok small';
          ok.textContent = 'Saved.';
          btns.after(ok);
          setTimeout(() => ok.remove(), 3000);
        }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    }

    let savedPrices = null;
    let pricesFormFilled = false;

    async function loadPrices() {
      const box = $('prices-saved');
      try {
        const r = await api('GET', 'api/prices');
        if (!r.prices) {
          box.innerHTML = '';
          $('prices-intro').hidden = false;
          return;
        }
        priceTz = r.time_zone;
        $('prices-intro').hidden = true;
        const typeLabel = { market_excl_vat: 'Market price, excl. VAT', market_incl_vat: 'Market price, incl. VAT', all_in: 'All-in' }[r.prices.price_type];
        const fx = r.prices.source.type === 'fixed' ? r.prices.source : null;
        const detailLine = fx
          ? (fx.mode === 'day_night'
            ? `Normal ${esc(fx.normal)} · low ${esc(fx.low)} from ${esc(fx.low_from)} until ${esc(fx.low_to)}${fx.weekend_low ? ', and all weekend' : ''} · all-in per kWh`
            : `${esc(fx.normal)} per kWh, all-in`)
          : `${esc(typeLabel)} · purchase fee ${esc(r.prices.purchase_fee)} · energy tax ${esc(r.prices.energy_tax)} · VAT ${esc(r.prices.vat_percent)}%${r.prices.forecast ? ` · forecast from ${esc(r.prices.forecast.entity_id)}` : ''}`;
        box.innerHTML = `
          <div class="card">
            <h2>Prices now · ${esc(r.prices.source.name)}</h2>
            <p class="muted small">${detailLine}</p>
            ${r.error ? `<div class="error">${esc(r.error)}</div>` : summaryHtml(r.summary) + forecastHtml(r.forecast)}
            <div class="buttons">
              <button class="secondary" data-act="remove">Remove price settings</button>
            </div>
          </div>`;
        // The settings are shown as a form right away, filled with what is saved.
        savedPrices = r.prices;
        if (!pricesFormFilled) {
          pricesFormFilled = true;
          await detectPrices(r.prices);
        }
        box.querySelector('[data-act=remove]').onclick = async () => {
          if (!confirm('Remove this price source from the app?')) return;
          await api('DELETE', 'api/prices');
          $('prices-form').hidden = true;
          pricesFormFilled = false;
          savedPrices = null;
          loadPrices();
        };
      } catch (err) {
        box.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    $('prices-detect').addEventListener('click', () => detectPrices());
    // Search again, but keep what is filled in now.
    $('prices-redetect').addEventListener('click', async () => {
      const keep = priceFormData();
      const src = keep.source;
      await detectPrices(src ? {
        source: src.type === 'fixed' ? { ...src, ...keep.fixed } : src,
        price_type: keep.price_type, purchase_fee: keep.purchase_fee, energy_tax: keep.energy_tax, vat_percent: keep.vat_percent,
        forecast: keep.forecast_entity ? { entity_id: keep.forecast_entity, price_type: keep.forecast_price_type, margin: keep.forecast_margin } : null,
      } : savedPrices);
    });
    $('prices-source').addEventListener('change', showSourceDetail);
    $('prices-test').addEventListener('click', testPrices);
    $('prices-test-fixed').addEventListener('click', testPrices);
    $('prices-test-fc').addEventListener('click', testPrices);
    $('forecast-entity').addEventListener('change', syncForecast);
    $('prices-form').fx_mode.addEventListener('change', syncFixed);
    $('prices-form').addEventListener('submit', savePrices);

    // ---------- Status ----------
    async function loadStatus() {
      const conn = $('conn');
      try {
        const s = await api('GET', 'api/status');
        conn.textContent = s.connected ? 'Connected' : 'Not connected';
        conn.className = s.connected ? 'ok' : 'fail';
        $('haver').textContent = s.ha_version || '–';
        $('tz').textContent = s.time_zone || '–';
        $('count').textContent = s.entity_count ?? '–';
        $('appver').textContent = s.app_version || '–';
        $('control').innerHTML = s.allow_control
          ? '<span class="ok">On</span> <span class="muted small">(live: the app starts and pauses the charger)</span>'
          : 'Off <span class="muted small">(turn on in the app\'s Configuration tab)</span>';
        $('batctl').innerHTML = s.allow_battery_control && s.allow_control ? '<span class="ok">On</span>' : 'Off <span class="muted small">(advice only)</span>';
        $('loglevel').textContent = s.log_level || '–';
        $('calwrite').innerHTML = s.allow_calendar_write ? '<span class="ok">Allowed</span>' : 'Off <span class="muted small">(test mode)</span>';
        $('refresh').innerHTML = s.refresh_minutes
          ? `every ${esc(s.refresh_minutes)} min${s.last_refresh ? ` <span class="muted small">(last ${esc(new Date(s.last_refresh).toLocaleTimeString('en-GB', { timeZone: s.time_zone, hour: '2-digit', minute: '2-digit' }))})</span>` : ''}`
          : '–';
        $('status-error').hidden = !s.error;
        $('status-error').textContent = s.error || '';
      } catch {
        conn.textContent = 'App not reachable';
        conn.className = 'fail';
      }
    }

    // ---------- Setup wizard ----------
    let wizardActive = false;
    let wizStep = 0;
    const WIZ = [
      { key: 'vehicle', label: 'Vehicle', text: 'Which car do you charge? Select <strong>Detect vehicles</strong>, or use <strong>No car integration?</strong> when your car is not in Home Assistant.' },
      { key: 'charger', label: 'Charger', text: 'Which charger do you use? Select <strong>Detect chargers</strong> and check the suggested entities. A charging power sensor makes the plan and savings more accurate.' },
      { key: 'grid', label: 'Grid', optional: true, text: 'Optional: your grid meter (for example a P1 meter) and main fuse, so the plan knows how much room the house leaves for the charger. You can skip this step.' },
      { key: 'prices', label: 'Prices', text: 'Where do your dynamic electricity prices come from? Select <strong>Detect price sources</strong>, fill in the costs from your energy contract, then <strong>Test</strong> and <strong>Save</strong>.' },
    ];

    async function checkWizard() {
      try {
        const st = await api('GET', 'api/setup');
        if (st.done) return false;
        wizardActive = true;
        renderWizard(st);
        return true;
      } catch {
        return false;
      }
    }

    function renderWizard(st) {
      const w = WIZ[wizStep];
      const last = wizStep === WIZ.length - 1;
      $('main-nav').hidden = true;
      $('settings-nav').hidden = true;
      const box = $('wizard');
      box.hidden = false;
      box.innerHTML = `
        <h2>Set up Smart Charging</h2>
        <p class="muted small">A few steps to get your first charging plan. Everything can be changed later under ⚙ Settings.</p>
        <div class="steps">${WIZ.map((x, i) => `<span class="step${i === wizStep ? ' current' : ''}${st[x.key] ? ' done' : ''}">${i + 1}. ${x.label}${st[x.key] ? ' ✓' : x.optional ? ' (optional)' : ''}</span>`).join('')}</div>
        <p>${w.text}</p>
        <div class="buttons">
          ${wizStep > 0 ? '<button class="secondary" id="wiz-back">Back</button>' : ''}
          ${w.optional && !st[w.key] ? '<button class="secondary" id="wiz-skip">Skip</button>' : ''}
          <button class="primary" id="wiz-next">${last ? 'Finish' : 'Next'}</button>
        </div>
        <div class="error" id="wiz-error" hidden></div>
        <details class="wiz-import">
          <summary class="small">Have a settings file (Export settings from another install or a backup)? Import it instead</summary>
          <div class="buttons"><label class="secondary filebtn">Import settings…<input type="file" id="wiz-file" accept="application/json,.json" hidden></label></div>
          <div id="wiz-import"></div>
        </details>`;
      $('wiz-file').onchange = (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) importFlow(file, $('wiz-import'), async () => {
          const now = await api('GET', 'api/setup');
          if (now.vehicle && now.charger && now.prices) return finishWizard();
          renderWizard(now);
        });
      };
      document.querySelectorAll('main > section').forEach((sec) => { sec.hidden = sec.id !== 'tab-' + w.key; });
      const go = async (delta, check) => {
        const now = await api('GET', 'api/setup');
        if (check && !now[w.key] && !w.optional) {
          $('wiz-error').textContent = `Save a ${w.label.toLowerCase()} first, then select ${last ? 'Finish' : 'Next'}.`;
          $('wiz-error').hidden = false;
          return;
        }
        if (delta > 0 && last) return finishWizard();
        wizStep = Math.max(0, Math.min(WIZ.length - 1, wizStep + delta));
        renderWizard(now);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      $('wiz-next').onclick = () => go(1, true);
      if ($('wiz-back')) $('wiz-back').onclick = () => go(-1, false);
      if ($('wiz-skip')) $('wiz-skip').onclick = () => go(1, false);
    }

    async function finishWizard() {
      await api('POST', 'api/setup', { done: true });
      wizardActive = false;
      $('wizard').hidden = true;
      $('main-nav').hidden = false;
      showTab('overview');
    }

    // ---------- Settings › Solar ----------
    function syncSolar() {
      const f = $('solar-form');
      const on = f.enabled.checked;
      f.querySelectorAll('.sol-on').forEach((el) => { el.hidden = !on; });
      f.querySelectorAll('.sol-sensor').forEach((el) => { el.hidden = f.forecast.value !== 'sensor'; });
      f.querySelectorAll('.fi-market').forEach((el) => { el.hidden = f.fi_mode.value !== 'market'; });
      f.querySelectorAll('.fi-fixed').forEach((el) => { el.hidden = f.fi_mode.value !== 'fixed'; });
      f.querySelectorAll('.sol-phase').forEach((el) => { el.hidden = !f.phase_switching.checked; });
      const byEq = !$('sol-who').hidden && f.solar_control.value === 'equalizer';
      f.querySelectorAll('.sol-app').forEach((el) => { el.hidden = byEq; });
      const eq = solarEq;
      $('sol-eq-info').innerHTML = !eq ? '' : byEq
        ? `${shape('sun', 'amber', true)} ${esc(eq.name)}: surplus charging is <strong>${eq.surplus_on ? 'on' : 'off'}</strong> now. Grid power allowed is passed on as ${tidy(Math.round((Number(f.grid_allow_w.value) || 0) / 690))} A per phase on top of the surplus. The charger stays switched on while charging on solar; the Equalizer starts and stops.`
        : eq.surplus_on ? `<span class="differ">${esc(eq.name)}: surplus charging is on in the Easee app. With the app following the surplus, they would fight: turn it off in the Easee app, or choose the Equalizer here.</span>` : '';
    }
    let solarEq = null;

    async function loadSolar() {
      const f = $('solar-form');
      if (f.contains(document.activeElement)) return;
      let r;
      try {
        r = await api('GET', 'api/solar');
      } catch (err) {
        $('solar-status').innerHTML = `<div class="card error">${esc(err.message)}</div>`;
        return;
      }
      const c = r.settings;
      solarEq = r.equalizer || null;
      $('sol-who').hidden = !solarEq && c.solar_control !== 'equalizer';
      f.solar_control.value = c.solar_control === 'equalizer' ? 'equalizer' : 'app';
      f.enabled.checked = !!c.enabled;
      f.forecast.value = c.forecast;
      f.forecast_entity.innerHTML = '<option value="">— choose —</option>' + r.forecast_sensors.map((x) => `<option value="${esc(x.entity_id)}" ${x.entity_id === c.forecast_entity ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      f.forecast_factor.value = c.forecast_factor;
      f.house_base_w.value = c.house_base_w;
      f.fi_mode.value = c.feed_in.mode;
      f.fi_fee.value = c.feed_in.fee;
      f.fi_vat.value = c.feed_in.vat_percent;
      f.fi_fixed.value = c.feed_in.fixed;
      f.max_soc.value = c.max_soc;
      f.grid_allow_w.value = c.grid_allow_w;
      f.start_delay_min.value = c.start_delay_min;
      f.stop_delay_min.value = c.stop_delay_min;
      f.grid_sign.value = c.grid_sign;
      f.current_control.checked = c.current_control !== false;
      f.phase_switching.checked = !!c.phase_switching;
      f.phase_method_id.innerHTML = r.phase_methods.length
        ? r.phase_methods.map((m) => `<option value="${esc(m.id)}" ${m.id === c.phase_method_id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')
        : '<option value="">Your charger cannot switch phases from Home Assistant</option>';
      f.pv_entity.innerHTML = '<option value="">— none —</option>' + r.pv_sensors.map((x) => `<option value="${esc(x.entity_id)}" ${x.entity_id === c.pv_entity ? 'selected' : ''}>${esc(x.name)}${x.brand ? ` (${esc(x.brand)})` : ''}${x.power_w != null ? ` – ${tidy(x.power_w)} W` : ''}</option>`).join('');
      const fc = r.forecast || {};
      $('solar-fc-info').innerHTML = fc.error
        ? `<span class="differ">${esc(fc.error)}</span>`
        : fc.hours
          ? `Forecast: <strong>${tidy(fc.today_kwh)} kWh</strong> today, <strong>${tidy(fc.tomorrow_kwh)} kWh</strong> tomorrow (${fc.source === 'energy' ? `${fc.entries} forecast${fc.entries === 1 ? '' : 's'} in the Energy dashboard` : 'sensor'}). "Count on" 0.8 means the plan counts on 80 % of it.`
          : (r.energy.forecast_entries.length ? 'The Energy dashboard has a forecast, but it gives no hours yet.' : '<span class="differ">No solar forecast in the Energy dashboard.</span> Add Forecast.Solar (free, no account), Solcast or Open-Meteo Solar Forecast, and choose it under Settings → Dashboards → Energy → Solar panels → Solar production forecast.');
      $('solar-fi-note').innerHTML = r.price_type === 'all_in' && c.feed_in.mode === 'market'
        ? '<span class="differ">Your price source gives all-in prices, so the market price is not known: the fixed amount is used.</span>'
        : 'Example: market price 0.08, feed-in costs 0.02 → a kWh of own solar power is worth 0.06. Negative prices count too.';
      $('solar-grid-now').innerHTML = r.grid
        ? `${esc(r.grid.name)} now: ${r.grid.net_w == null ? 'not readable' : `${tidy(r.grid.net_w)} W, so you are ${r.grid.net_w < 0 ? '<strong>exporting</strong>' : '<strong>importing</strong>'}`}. Check that this matches what you see.`
        : '<span class="differ">No grid meter: set it up in Settings › Grid first. The app sees the surplus there.</span>';
      $('solar-current-note').innerHTML = r.current_method
        ? `Through ${esc(r.current_method.label)} (Settings › Charger). The app sets the current back to the maximum when it charges at full power again.`
        : '<span class="differ">Your charger has no way to set the current from Home Assistant. Solar charging then only starts when the surplus covers the full charging power.</span>';
      $('solar-phase-note').textContent = r.phase_methods.length
        ? 'Below 6 A on three phases (about 4.1 kW) the charger switches to one phase (from about 1.4 kW), and back when there is enough sun. At most every 10 minutes.'
        : 'Phase switching is possible with Easee, go-e and Peblar, when their integration offers it.';
      const n = r.now;
      $('solar-status').innerHTML = c.enabled ? `<div class="card"><h2>${shape('sun', 'amber', true)} Solar now</h2>
          <p class="small">Mode on Home: <strong>${esc({ plan: 'Price plan', plan_solar: 'Plan + solar', solar: 'Solar only' }[r.mode])}</strong>${r.pv_now_w != null ? ` · solar power ${tidy(r.pv_now_w)} W` : ''}${n && Number.isFinite(n.available_w) ? ` · available for the car ${tidy(Math.max(0, n.available_w))} W` : ''}</p>
          ${n && n.reason ? `<p class="muted small">${esc(n.reason)}</p>` : ''}</div>` : '';
      syncSolar();
    }

    $('settings-export').onclick = async () => {
      const box = $('settings-import');
      try {
        const d = await api('GET', 'api/settings/export');
        const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `smart-charging-planner-settings-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        box.innerHTML = '<p class="small"><span class="ok">Exported.</span> Keep the file somewhere safe; it contains the names of your entities and devices.</p>';
      } catch (err) {
        box.innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
      }
    };
    $('settings-file').onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) importFlow(file, $('settings-import'), () => {
        $('settings-import').innerHTML = '<p class="small"><span class="ok">Settings imported.</span> Check Settings › Overview to see that everything is set up.</p>';
      });
    };
    // Import: preview first, then replace after "Replace my settings".
    async function importFlow(file, box, done) {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        box.innerHTML = '<p class="small differ">This file is not readable (no JSON).</p>';
        return;
      }
      try {
        const r = await api('POST', 'api/settings/import/preview', data);
        const sm = r.summary;
        const row = (k, val) => `<div class="row"><span class="label">${k}</span><span>${val}</span></div>`;
        box.innerHTML = `
          <div class="note" style="margin-top:12px">
            <p class="small"><strong>Replace all settings with this file?</strong> From version ${esc(sm.from_version || '?')}${sm.exported_at ? `, exported ${esc(dayHm(Date.parse(sm.exported_at)))}` : ''}.</p>
            ${row('Car', esc(sm.vehicle || '–'))}${row('Charger', esc(sm.charger || '–'))}${row('Prices', esc(sm.prices || '–'))}${row('Solar', sm.solar ? 'on' : 'off')}${row('Home battery', sm.battery ? 'on' : 'off')}
            ${sm.notes.length ? `<ul class="small differ">${sm.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="small ok">Everything in the file was found in this Home Assistant.</p>'}
            <div class="buttons"><button class="primary" id="settings-import-go">Replace my settings</button><button class="secondary" id="settings-import-cancel">Cancel</button></div>
          </div>`;
        $('settings-import-cancel').onclick = () => { box.innerHTML = ''; };
        $('settings-import-go').onclick = async () => {
          $('settings-import-go').disabled = true;
          try {
            await api('POST', 'api/settings/import', data);
            done();
          } catch (err) {
            box.innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
          }
        };
      } catch (err) {
        box.innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
      }
    }
    $('diag-download').onclick = async () => {
      const out = $('diag-result');
      out.textContent = 'Collecting…';
      try {
        const d = await api('GET', 'api/diagnostics');
        const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `smart-charging-planner-diagnostics-${d.app_version}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        out.innerHTML = '<span class="ok">Downloaded.</span> Attach it to your bug report.';
      } catch (err) {
        out.innerHTML = `<span class="differ">${esc(err.message)}</span>`;
      }
    };
    $('solar-form').addEventListener('change', syncSolar);
    document.querySelectorAll('#battery-test-buttons [data-bat]').forEach((b) => {
      b.onclick = async () => {
        const out = $('battery-test-result');
        out.innerHTML = '<p class="muted small">Sending…</p>';
        try {
          const r = await api('POST', 'api/battery/test', { action: b.dataset.bat });
          out.innerHTML = `<p class="small"><span class="ok">Sent: ${esc(r.action)}</span><br><span class="src">${r.sent.map(esc).join('<br>')}</span></p>`;
        } catch (err) {
          out.innerHTML = `<p class="small differ">${esc(err.message)}</p>`;
        }
      };
    });
    $('solar-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('.form-error');
      const btn = f.querySelector('button[type=submit]');
      err.hidden = true;
      try {
        await api('POST', 'api/solar', {
          enabled: f.enabled.checked, forecast: f.forecast.value, forecast_entity: f.forecast_entity.value,
          forecast_factor: f.forecast_factor.value, house_base_w: f.house_base_w.value, pv_entity: f.pv_entity.value,
          grid_sign: f.grid_sign.value, start_delay_min: f.start_delay_min.value, stop_delay_min: f.stop_delay_min.value,
          grid_allow_w: f.grid_allow_w.value, max_soc: f.max_soc.value, current_control: f.current_control.checked,
          phase_switching: f.phase_switching.checked, phase_method_id: f.phase_method_id.value,
          feed_in: { mode: f.fi_mode.value, fee: f.fi_fee.value, fixed: f.fi_fixed.value, vat_percent: f.fi_vat.value },
          solar_control: $('sol-who').hidden ? 'app' : f.solar_control.value,
        });
        document.activeElement.blur();
        await loadSolar();
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save solar settings'; }, 2000);
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
      }
    });

    // ---------- Settings › Battery ----------
    const ACTION_TEXT = { auto: 'normal (own mode)', charge: 'charge from the grid', discharge: 'discharge', hold: 'hold (save)', no_discharge: 'no discharging' };
    let batteryData = null;

    function syncBattery() {
      const f = $('battery-form');
      f.querySelectorAll('.bat-on').forEach((el) => { el.hidden = !f.enabled.checked; });
      const c = batteryData && batteryData.candidates.find((x) => x.soc_entity === f.battery.value);
      $('battery-detail').innerHTML = c ? `
        <p class="small">${shape('battery', 'purple', true)} <strong>${esc(c.brand)}</strong> · ${esc(c.integration)} · now ${c.soc != null ? `${tidy(c.soc)} %` : '–'}${c.power_kw != null ? ` · ${c.power_kw >= 0 ? 'charging' : 'discharging'} ${tidy(Math.abs(c.power_kw))} kW` : ''}${c.capacity_kwh ? ` · ${tidy(c.capacity_kwh)} kWh` : ''}</p>
        <p class="small">${c.control.supported.length ? `The app can: ${c.control.supported.map((a) => esc(ACTION_TEXT[a] || a)).join(', ')}.` : '<span class="differ">The app can only read this battery; the plan is advice.</span>'} ${c.control.note ? `<span class="muted">${esc(c.control.note)}</span>` : ''}</p>
        ${c.sign_verified ? '' : '<p class="muted small">The sign of the power sensor is not documented in the integration; check below that charging shows as charging.</p>'}` : '';
      const range = f.ev_discharge.value === 'range';
      $('bat-ev-range').hidden = !range;
      if (range) $('bat-ev-bar').innerHTML = levelBarHtml(Number(f.min_pct.value), Number(f.ev_to_pct.value), Number(f.ev_from_pct.value), Number(f.max_pct.value), c && c.soc);
      const warn = $('bat-ev-warn');
      const cannot = c && c.control.supported.length && !c.control.protects_car && f.ev_discharge.value !== 'always';
      warn.hidden = !cannot;
      warn.textContent = cannot ? `${c.brand} cannot be told to stop discharging from Home Assistant, so while the car charges the battery may still discharge into it.` : '';
    }

    // The battery levels as one bar: never below / kept for the house / for
    // the car once started / starts charging the car; with the level now.
    function levelBarHtml(minP, toP, fromP, maxP, socNow) {
      const ok = [minP, toP, fromP, maxP].every(Number.isFinite) && minP <= toP && toP < fromP && fromP <= maxP;
      if (!ok) return '<p class="small differ">The levels do not fit: never below ≤ stop &lt; start ≤ never above.</p>';
      const seg = (cls, a, b) => (b > a ? `<span class="${cls}" style="width:${b - a}%"></span>` : '');
      const mark = (p, text, below) => `<span class="levelmark${below ? ' below' : ''}" style="left:${Math.min(97, Math.max(3, p))}%">${text}</span>`;
      return `
        <div class="levelwrap">
          ${mark(toP, `stop ${toP}%`)}${mark(fromP, `start ${fromP}%`)}
          ${Number.isFinite(socNow) ? mark(socNow, `now ${Math.round(socNow)}%`, true) : ''}
          <div class="levelbar">${seg('lv-off', 0, minP)}${seg('lv-house', minP, toP)}${seg('lv-car', toP, fromP)}${seg('lv-start', fromP, 100)}</div>
        </div>
        <div class="levellegend">
          <span><i style="background:rgba(var(--rgb-grey),.35)"></i>never used (below ${minP}%)</span>
          <span><i style="background:rgba(var(--rgb-amber),.55)"></i>only for the house</span>
          <span><i style="background:rgba(var(--rgb-purple),.45)"></i>for the car, once started</span>
          <span><i style="background:rgba(var(--rgb-purple),.85)"></i>starts charging the car</span>
        </div>
        <p class="muted small">While the car charges, the battery helps from ${fromP}% until it is at ${toP}%. It starts again only when it is back at ${fromP}%.</p>`;
    }

    async function loadBattery() {
      const f = $('battery-form');
      if (f.contains(document.activeElement)) return;
      let r;
      try {
        r = await api('GET', 'api/battery');
      } catch (err) {
        $('battery-status').innerHTML = `<div class="card error">${esc(err.message)}</div>`;
        return;
      }
      batteryData = r;
      const c = r.settings;
      f.battery.innerHTML = '<option value="">— no home battery —</option>' + r.candidates.map((x) => `<option value="${esc(x.soc_entity)}" data-platform="${esc(x.platform)}" ${x.soc_entity === c.soc_entity ? 'selected' : ''}>${esc(x.name)} (${esc(x.brand)})</option>`).join('');
      if (!c.soc_entity && r.candidates[0]) f.battery.value = r.candidates[0].soc_entity;
      f.enabled.checked = !!c.enabled;
      for (const k of ['capacity_kwh', 'efficiency', 'charge_kw', 'discharge_kw', 'min_pct', 'max_pct', 'wear']) f[k].value = c[k];
      if (!c.soc_entity) {
        const cand = r.candidates.find((x) => x.soc_entity === f.battery.value);
        if (cand && cand.capacity_kwh) f.capacity_kwh.value = tidy(cand.capacity_kwh);
        if (cand) f.power_sign.value = cand.power_sign === 'discharge_positive' ? 'discharge_positive' : 'charge_positive';
      } else f.power_sign.value = c.power_sign;
      f.arbitrage.checked = c.arbitrage !== false;
      f.ev_discharge.value = c.ev_discharge;
      f.ev_from_pct.value = c.ev_from_pct ?? 80;
      f.ev_to_pct.value = c.ev_to_pct ?? 40;
      f.solar_priority.value = c.solar_priority;
      $('battery-brands').innerHTML = r.brands.map((b) => `${b.read_only ? shape('alert', 'grey', true) : shape('check', 'green', true)} ${esc(b.name)} <span class="muted">(${esc(b.integration)}${b.read_only ? ', read only' : ''})</span>`).join('<br>');
      const allowed = r.control_allowed && r.battery_control_allowed;
      $('battery-status').innerHTML = c.enabled && r.now ? `<div class="card"><h2>${shape('battery', 'purple', true)} Battery now</h2>
          <p class="small">${r.now.soc != null ? `${tidy(r.now.soc)} %` : 'level unknown'}${r.now.power_kw != null ? ` · ${r.now.power_kw >= 0 ? 'charging' : 'discharging'} ${tidy(Math.abs(r.now.power_kw))} kW` : ''} · stored solar power about ${tidy(r.ledger.solar_kwh)} kWh</p>
          <p class="muted small">${allowed ? 'The app steers the battery (Allow control and Allow home battery control are on).' : 'Advice only: turn on Allow control and Allow home battery control in Home Assistant › Apps › Smart Charging Planner › Configuration to let the app steer the battery.'}</p></div>` : '';
      syncBattery();
    }

    $('battery-form').addEventListener('change', syncBattery);
    $('battery-form').addEventListener('input', (e) => { if (['ev_from_pct', 'ev_to_pct', 'min_pct', 'max_pct'].includes(e.target.name)) syncBattery(); });
    $('battery-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('.form-error');
      const btn = f.querySelector('button[type=submit]');
      err.hidden = true;
      const opt = f.battery.selectedOptions[0];
      try {
        await api('POST', 'api/battery', {
          soc_entity: f.battery.value, platform: opt ? opt.dataset.platform : undefined,
          enabled: f.enabled.checked, capacity_kwh: f.capacity_kwh.value, efficiency: f.efficiency.value,
          charge_kw: f.charge_kw.value, discharge_kw: f.discharge_kw.value, min_pct: f.min_pct.value, max_pct: f.max_pct.value,
          wear: f.wear.value, power_sign: f.power_sign.value, arbitrage: f.arbitrage.checked,
          ev_discharge: f.ev_discharge.value, solar_priority: f.solar_priority.value,
          ev_from_pct: f.ev_from_pct.value, ev_to_pct: f.ev_to_pct.value,
        });
        document.activeElement.blur();
        await loadBattery();
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save battery settings'; }, 2000);
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
      }
    });

    // Home: may the battery charge the car?
    function EV_TEXT(b) {
      switch (b.ev_discharge) {
        case 'always': return 'The battery may charge the car.';
        case 'solar_only': return 'The battery charges the car only with stored solar power.';
        case 'range': return `The battery charges the car from ${b.ev_from_pct}% down to ${b.ev_to_pct}%${b.ev_range_active ? ' (allowed now)' : ''}.`;
        default: return 'The battery does not charge the car.';
      }
    }

    // Home: the battery plan as periods.
    function batteryHtml(d) {
      const b = d.battery;
      if (!b) return '';
      if (b.error) return `<div class="card"><h2>${shape('battery', 'purple', true)} Home battery</h2><div class="error">${esc(b.error)}</div></div>`;
      const now = d.battery_now;
      const periods = [];
      for (const a of b.actions || []) {
        const last = periods[periods.length - 1];
        if (last && last.action === a.action && Math.abs(last.end - a.start) < 1000) { last.end = a.end; last.soc = a.soc_pct; }
        else periods.push({ start: a.start, end: a.end, action: a.action, soc: a.soc_pct });
      }
      const shown = periods.filter((x) => x.action !== 'auto').slice(0, 6);
      return `
        <div class="card">
          <h2>${shape('battery', 'purple', true)} Home battery</h2>
          <p class="small">${esc(b.name || '')}: <strong>${b.soc != null ? `${tidy(b.soc)} %` : '–'}</strong>${b.power_kw != null ? ` · ${b.power_kw >= 0 ? 'charging' : 'discharging'} ${tidy(Math.abs(b.power_kw))} kW` : ''}${now ? ` · now: <strong>${esc(ACTION_TEXT[now.action] || now.action)}</strong> <span class="muted">(${esc(now.reason)})</span>` : ''}</p>
          ${shown.length ? `<table class="periods"><tr><th>When</th><th>Battery</th><th class="n">Level after</th></tr>
            ${shown.map((x) => `<tr><td>${esc(dayHm(x.start))}–${esc(hm(x.end))}</td><td>${esc(ACTION_TEXT[x.action] || x.action)}</td><td class="n">${tidy(x.soc)} %</td></tr>`).join('')}</table>
            <p class="muted small">Other times: normal (its own mode, covering the house and taking the sun).</p>` : '<p class="muted small">The battery stays in its own mode: nothing to gain by steering it with the known prices.</p>'}
          ${b.saving > 0.005 ? `<p class="small">Expected saving compared with leaving it alone: <strong>${money(b.saving)}</strong>.</p>` : ''}
          <p class="muted small">${shape('car', b.ev_discharge === 'never' ? 'grey' : 'purple', true)} ${esc(EV_TEXT(b))}</p>
          ${b.control_allowed ? '' : `<p class="muted small">${b.control.supported.length ? 'Advice only: the app steers the battery once Allow home battery control is on.' : esc(b.control.note || 'This battery can only be read.')}</p>`}
        </div>`;
    }

    // ---------- Settings › Overview: is everything set up well? ----------
    async function loadChecklist() {
      const box = $('setup-body');
      try {
        const r = await api('GET', 'api/checklist');
        const look = { ok: ['check', 'green'], warn: ['alert', 'orange'], missing: ['alert', 'red'], optional: ['check', 'grey'] };
        const stateLabel = { ok: 'Ready', warn: 'Check', missing: 'Required', optional: 'Optional' };
        const tile = (i) => {
          const tag = i.page ? 'a' : 'div';
          const attrs = i.page ? ` href="#" data-goto="${esc(i.page)}"` : '';
          return `<${tag} class="settings-tile state-${esc(i.state)}"${attrs}>
            ${shape(...look[i.state], true)}
            <span class="settings-tile-copy"><strong>${esc(i.title)}</strong><small>${esc(i.detail)}</small></span>
            <span class="settings-state">${esc(stateLabel[i.state] || i.state)}</span>
          </${tag}>`;
        };
        const todo = r.items.filter((i) => i.state === 'missing' || i.state === 'warn');
        const complete = r.ready && !todo.length;
        box.innerHTML = `
          <div class="card settings-hero ${complete ? 'is-ready' : r.ready ? 'has-warnings' : 'needs-work'}">
            <div class="entity">
              ${shape(complete ? 'check' : 'alert', complete ? 'green' : r.ready ? 'orange' : 'red')}
              <div class="txt">
                <span class="page-eyebrow">SETUP STATUS</span>
                <div class="headline">${r.ready ? (todo.length ? 'Ready, with a few points' : 'Everything is set up') : 'Not ready yet'}</div>
                <div class="secondary">Open a tile to view or adjust that part. Daily choices stay on Home; departures live under Plan.</div>
              </div>
              <span class="settings-count">${todo.length ? `${todo.length} to check` : 'All clear'}</span>
            </div>
          </div>
          <div class="settings-grid">${r.items.map(tile).join('')}</div>
          ${lastPlan && lastPlan.planning ? (() => { const d = lastPlan; return `
          <div class="card settings-note-card">
            <h2>${shape('control', 'grey', true)} Planning settings in Home Assistant</h2>
            <p class="muted small">Charging loss margin ${esc(d.planning.loss_percent)} % · ${d.planning.continuous !== false ? `one continuous period, unless splitting saves at least ${money(d.planning.min_split_saving)}` : 'split charging allowed'} · house load ${d.planning.use_house_load !== false ? 'on' : 'off'} · Allow control ${d.control_allowed ? 'on' : 'off'}.</p>
            <p class="muted small">These options and the safety switches are managed in Home Assistant: Settings → Apps → Smart Charging Planner → Configuration.</p>
          </div>`; })() : ''}`;
      } catch (err) {
        box.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
      }
    }

    async function loadNotifyStatus() {
      try {
        const n = await api('GET', 'api/notify');
        const tm = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        const sel = $('notify-choice');
        const current = n.notify_service || '';
        const list = n.choices || [];
        const known = list.some((c) => c.id === current);
        sel.innerHTML = '<option value="">— no notifications —</option>' +
          list.map((c) => `<option value="${esc(c.id)}"${c.id === current ? ' selected' : ''}>${esc(c.id)}</option>`).join('') +
          (current && !known ? `<option value="${esc(current)}" selected>${esc(current)} (not found in Home Assistant)</option>` : '');
        $('notify-state').innerHTML = current
          ? `<span class="ok">On</span> · ${n.notify_start_stop ? 'every start and pause, and problems' : 'problems only'}`
          : (list.length ? 'Choose where notifications go, for example your phone (notify.mobile_app_…).' : '<span class="differ">No notify actions found in Home Assistant. Install the Home Assistant app on your phone to get notify.mobile_app_….</span>');
        const l = n.last_notification;
        $('notify-last').innerHTML = l ? `${esc(tm(l.at))} · ${esc(l.title)}${l.sent ? '' : ` <span class="differ">not sent: ${esc(l.error || '')}</span>`}<div class="src">${esc(l.message)}</div>` : '<span class="muted">none yet</span>';
        const p = n.last_publish;
        $('sensors-state').innerHTML = n.publish_sensors
          ? `<span class="ok">On</span>${p ? `<div class="src">${p.error ? `<span class="differ">${esc(p.error)}</span>` : `last update ${esc(tm(p.at))}`}</div>` : ''}<div class="src">sensor.smart_charging_status, _next_start, _next_end, _planned_energy, _planned_cost, _saving, _departure, binary_sensor.smart_charging_charge_now</div>`
          : 'Off';
        $('notify-test').disabled = !n.notify_service;
      } catch {
        // status card stays as it is
      }
    }

    $('notify-save').addEventListener('click', async () => {
      const btn = $('notify-save');
      const out = $('notify-test-result');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await api('POST', 'api/notify', { service: $('notify-choice').value });
        out.innerHTML = '<div class="note">Saved. Use "Send test notification" to check it.</div>';
      } catch (err) {
        out.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
      btn.textContent = 'Save';
      btn.disabled = false;
      loadNotifyStatus();
    });

    $('notify-test').addEventListener('click', async () => {
      const out = $('notify-test-result');
      out.innerHTML = '<p class="muted small">Sending…</p>';
      try {
        await api('POST', 'api/notify/test');
        out.innerHTML = '<div class="note">Test notification sent. Check your phone.</div>';
      } catch (err) {
        out.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
      loadNotifyStatus();
    });

    $('wizard-again').addEventListener('click', async () => {
      await api('POST', 'api/setup', { done: false });
      wizStep = 0;
      checkWizard();
    });

    // ---------- Tabs ----------
    // Use: Home, Planning, History. Set up once: Settings.
    const SETTINGS_SUBS = ['setup', 'vehicle', 'charger', 'grid', 'prices', 'solar', 'battery', 'ctlset', 'status', 'diag'];
    const HISTORY_SUBS = ['savings', 'log'];
    let settingsSub = 'setup';
    let historySub = 'savings';

    // Show a tab. Sub pages can be named directly ('charger', 'log').
    const PAGE_META = {
      departures: ['PLAN', 'Plan departures', 'Choose when the car must be ready and which battery level you need.', 'departures', 'blue'],
      savings: ['ACTIVITY', 'Savings', 'See what smart charging changed compared with charging immediately.', 'savings', 'green'],
      log: ['ACTIVITY', 'Charging activity', 'Follow decisions, charger commands and conflicts in one place.', 'log', 'blue'],
      setup: ['SETTINGS', 'Settings overview', 'Check the complete setup and jump straight to anything that needs attention.', 'settings', 'blue'],
      vehicle: ['SETTINGS', 'Vehicle', 'Choose the battery and connection data the plan should use.', 'car', 'green'],
      charger: ['SETTINGS', 'Charger', 'Connect the charger and verify how it can be controlled.', 'charger', 'blue'],
      grid: ['SETTINGS', 'Grid', 'Set the grid meter and the electrical limits the plan must respect.', 'grid', 'orange'],
      prices: ['SETTINGS', 'Prices', 'Configure real electricity prices and an optional multi-day forecast.', 'prices', 'green'],
      solar: ['SETTINGS', 'Solar', 'Plan with solar production and control charging on live surplus.', 'sun', 'amber'],
      battery: ['SETTINGS', 'Home battery', 'Balance the car, home battery, solar energy and electricity prices.', 'battery', 'purple'],
      ctlset: ['SETTINGS', 'Charging rules', 'Fine-tune safety, timing and the way the app controls charging.', 'control', 'green'],
      status: ['SETTINGS', 'Notifications', 'Choose where updates are sent and inspect published sensors.', 'status', 'blue'],
      diag: ['SETTINGS', 'Diagnostics', 'Check the connection, test control and export troubleshooting data.', 'alert', 'grey'],
    };

    function ensurePageHeading(name) {
      const section = $('tab-' + name);
      const meta = PAGE_META[name];
      if (!section || !meta) return;
      section.classList.add('app-page', 'page-' + name);
      if (section.querySelector(':scope > .page-heading')) return;
      section.insertAdjacentHTML('afterbegin', `
        <header class="page-heading">
          ${shape(meta[3], meta[4])}
          <div>
            <span class="page-eyebrow">${esc(meta[0])}</span>
            <h2>${esc(meta[1])}</h2>
            <p>${esc(meta[2])}</p>
          </div>
        </header>`);
    }

    let currentShow = 'overview';
    function showTab(name) {
      if (name === 'control') name = 'ctlset';
      let main = name;
      let sub = null;
      if (SETTINGS_SUBS.includes(name)) { main = 'settings'; sub = name; settingsSub = name; }
      else if (HISTORY_SUBS.includes(name)) { main = 'history'; sub = name; historySub = name; }
      else if (name === 'settings') sub = settingsSub;
      else if (name === 'history') sub = historySub;
      document.querySelectorAll('#main-nav .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === main));
      $('settings-nav').hidden = main !== 'settings' || wizardActive;
      $('history-nav').hidden = main !== 'history';
      document.querySelectorAll('#settings-nav .subtab, #history-nav .subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
      const show = sub || main;
      currentShow = show;
      ensurePageHeading(show);
      document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== 'tab-' + show; });
      if (show === 'status') loadNotifyStatus();
      if (show === 'diag') { loadStatus(); loadControl(); }
      if (show === 'setup') loadChecklist();
      if (show === 'solar') loadSolar();
      if (show === 'battery') loadBattery();
      if (show === 'overview') loadOverview();
      if (show === 'departures') loadDepartures();
      if (show === 'savings') loadSavings();
      if (show === 'log' || show === 'ctlset' || show === 'charger') loadControl();
      [0, 250, 1000].forEach((delay) => setTimeout(() => refreshRangeValues(), delay));
    }
    document.querySelectorAll('#main-nav .tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
    document.querySelectorAll('#settings-nav .subtab, #history-nav .subtab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.sub)));

    // Icons on the tabs.
    const NAV_ICONS = { overview: 'overview', departures: 'departures', history: 'chart', savings: 'savings', log: 'log', settings: 'settings',
      setup: 'check', vehicle: 'car', charger: 'charger', grid: 'grid', prices: 'prices', solar: 'sun', battery: 'battery', ctlset: 'control', status: 'bell', diag: 'status' };
    document.querySelectorAll('#main-nav .tab, #settings-nav .subtab, #history-nav .subtab').forEach((b) => {
      const label = b.textContent.replace('⚙', '').trim();
      b.innerHTML = `${icon(NAV_ICONS[b.dataset.tab || b.dataset.sub])}<span>${esc(label)}</span>`;
    });
    $('app-title').insertAdjacentHTML('afterbegin', shape('charger', 'blue'));
    document.querySelectorAll('h2[data-icon]').forEach((h) => h.insertAdjacentHTML('afterbegin', shape(h.dataset.icon, h.dataset.color, true)));

    // ---------- Start ----------
    for (const kind of Object.keys(SECTIONS)) {
      sectionShell(kind);
      loadSaved(kind);
    }
    enhanceRangeControls();
    setTimeout(() => refreshRangeValues(), 0);
    // The start/stop method is part of setting up the charger.
    $('charger-extra').appendChild($('method-card'));
    loadStatus();
    loadPrices();
    loadChargerBar().finally(() => checkWizard().then((active) => { if (!active) loadOverview(); }));
    setInterval(() => {
      const busy = document.activeElement.form === $('boost-form') || ($('boost-check') && $('boost-check').innerHTML);
      if (!wizardActive && !$('tab-overview').hidden && !busy) loadOverview();
    }, 60000);
    setInterval(() => {
      for (const kind of Object.keys(SECTIONS)) {
        const busy = $(`tab-${kind}`).contains(document.activeElement) || ($('control-result') && $('control-result').innerHTML && kind === 'charger');
        if ($(`${kind}-saved`).innerHTML && !busy && !$(`tab-${kind}`).hidden) loadSaved(kind);
      }
    }, 30000);
