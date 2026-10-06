'use strict';

// Easee Equalizer: surplus charging (solar). The Equalizer reads the meter
// itself and sets the charger's current and phases to the solar surplus.
// When the user lets the Equalizer do solar charging, the app only switches
// its surplus charging on (charging on solar) and off (full power: planned
// blocks, Charge now), with the Easee integration's own action
// easee.set_surplus_charging (fields: device_id, enable, current).
//
// Home Assistant Easee integration (nordicopen/easee_hass): the Equalizer has
// a "Surplus charging" switch (diagnostic, key "surplus"); the action needs
// the Equalizer's device_id as text.

// The Equalizer with surplus charging, if Home Assistant has one.
function detectEqualizer(entities, states, devices = []) {
  const name = (e) => {
    const s = states.find((x) => x.entity_id === e.entity_id);
    return `${e.entity_id} ${(s && s.attributes && s.attributes.friendly_name) || ''}`.toLowerCase();
  };
  const sw = entities.find((e) => e.platform === 'easee' && e.entity_id.startsWith('switch.') && /surplus/.test(name(e)) && e.device_id);
  if (!sw) return null;
  const st = states.find((x) => x.entity_id === sw.entity_id);
  const dev = devices.find((d) => d.id === sw.device_id);
  return {
    device_id: sw.device_id,
    name: (dev && (dev.name_by_user || dev.name)) || 'Easee Equalizer',
    switch_entity: sw.entity_id,
    surplus_on: st ? st.state === 'on' : null,
    max_import_a: st && st.attributes ? Number(st.attributes.surplusChargingCurrent ?? st.attributes.surplus_charging_current) || 0 : null,
  };
}

// Amps per phase the Equalizer may take from the grid on top of the surplus.
function importAmps(gridAllowW, phases) {
  const a = Math.round((Number(gridAllowW) || 0) / 230 / (phases === 1 ? 1 : 3));
  return Math.max(0, Math.min(40, a));
}

function surplusCommand(eq, enable, amps) {
  return {
    what: enable ? 'Equalizer surplus charging on' : 'Equalizer surplus charging off',
    service: 'easee.set_surplus_charging',
    data: { device_id: String(eq.device_id), enable: !!enable, current: enable ? amps : 0 },
    target: null,
  };
}

module.exports = { detectEqualizer, importAmps, surplusCommand };
