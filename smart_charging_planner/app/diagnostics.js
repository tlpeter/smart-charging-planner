'use strict';

// Public diagnostics use an allowlist, not a blacklist of personal fields.
// No reverse identifier map, free-form reason/error text or raw log is exported.
const KEYS = new Set(`generated_at app_version ha_version time_zone connected options settings control_check detected entities plan now control_log
allow_control allow_battery_control allow_calendar_write publish_sensors loss_percent continuous_charging min_split_saving use_house_load refresh_minutes log_level
vehicles chargers grid prices departures rules solar battery notify recipients multi_car multi_charger vehicle charger routing confirmed basis_explicit
charge_stops min_power_kw max_detour_km reserve_pct only_countries charge_to_pct arrive_min_pct
precondition minutes way_back
id device_id vehicle_id charger_id entity_id config_entry_id soc_entity power_entity capacity_entity status_entity switch_entity plugged_entity charging_entity charge_limit_entity preheat_entity net_entity import_entity export_entity current_l1_entity current_l2_entity current_l3_entity max_current_entities datetime_entity
platform integration type domain source mode available reason_code code supported recommended allowed start_stop current phase phases phase_method_id current_id start_stop_id actions commands service target data value option entity_ids
enabled capacity_kwh charge_kw discharge_kw min_pct max_pct efficiency wear arbitrage ev_discharge ev_from_pct ev_to_pct solar_priority power_sign
min_soc_enabled min_soc min_soc_entity min_soc_max_price min_choice force_minutes hysteresis car_limit_off battery_care_enabled battery_care_soc battery_care_hours
stale_hours main_fuse max_current max_source load_balancer phases_now control_allowed battery_control_allowed live sent agrees held waiting blocked charging plugged power_w amps
state last_changed last_updated last_reported attributes unit_of_measurement device_class state_class min max step surplusChargingCurrent
computed_at notes planning target_soc wanted_soc default_soc ready_by departure time soc count first last forecast
start end at until started end_time start_time kwh price total solar_kwh expected grid_kwh solar_kw solar_price pv_kw
blocks planned_kwh needed_kwh saving savings ready_guard latest_safe_start expected_ready safety_margin_minutes profile days charger_subtracted house_load
how order result pause cars connected_id ask candidates conflict chosen charger_plugged count_today count_tomorrow interval_minutes price_type purchase_fee energy_tax vat_percent margin
battery_now ev_chargers ev_plan_count ev_planned_kwh solar_now available_w grid_w solar_equalizer shared reserve strategy restored restoring failed manual signature
charge_for boost charge_for_until charging_now now_w power planned_kw theoretical_kw learned actual_kw readings ok assumed estimate session_uncertain kwh_since last_soc age_ms
solar_control current_control phase_switching forecast_factor house_base_w grid_sign grid_allow_w max_soc feed_in fixed fee normal low low_from low_to model
control check importable action controls stopped round_trip_loss uses_forecast recovery pending legacy error
phases_a left_a fits L1 L2 L3
`.split(/\s+/));
const SAFE = new Set(`on off unknown unavailable none auto charge discharge hold no_discharge pause wait ready charging connected disconnected
advice_only action_needed at_risk not_achievable on_track no_goal
fixed action attribute single day_night all_in market_excl_vat market_incl_vat osm custom offline
import_positive export_positive charge_positive discharge_positive never always solar_only range smart car battery
energy sensor app equalizer plan solar plan_solar target soc kwh session_kwh manual_soc
planned boost below_minimum preheat ready_guard at_target current_limit shared_wait solar_wait control_wait
battery_plan battery_min battery_max battery_soc_unknown battery_min_unsupported battery_max_unsupported battery_auto battery_charge battery_discharge battery_hold battery_no_discharge battery_restored
calendar_cached calendar_error missing_data no_departure uses_forecast forecast_error enter_soc already_at_target car_limit
sensor switch select number button entity status log service device config_entry
renault easee wallbox myskoda kia_uvo tesla_fleet teslemetry tessie volkswagen_we_connect_id volkswagen we_connect_id
hyundai_kia_connect fordpass volvo volvooncall polestar_api mercedesme_api
sigen sigenergy huawei_solar solaredge_modbus_multi victron goodwe powerwall homewizard marstek_modbus marstek_local_api sessy zonneplan_one growatt_server anker_solix ecoflow_cloud
zaptec alfen go_echarger goecharger peblar ocpp ohme tesla_wall_connector
energyzero easyenergy tibber nordpool template dsmr fronius
W kW MW Wh kWh A % s power current battery energy measurement total_increasing
SELF_CONSUMPTION SELF_CONSUMPTION_WITH_BATTERY_LIFE KEEP_CHARGED EXTERNAL_CONTROL
autonomous backup self_consumption general eco_charge eco_discharge zero standby to_full zero_charge_only idle nom
switch_entity number_entity select_entity service_entity charging_started charging_paused
no_grid main_fuse net_power phase_currents load_balancer net_power_fallback no_reading battery_capacity L1 L2 L3
`.split(/\s+/));
const SERVICES = new Set(`switch.turn_on switch.turn_off number.set_value select.select_option button.press
script.turn_on homeassistant.turn_on homeassistant.turn_off
easee.set_charger_dynamic_limit easee.set_charger_phase_mode
huawei_solar.forcible_charge huawei_solar.forcible_discharge huawei_solar.stop_forcible_charge
marstek_local_api.set_passive_mode
`.split(/\s+/));
const ID = /^(?:id|.*_id|.*_ids|.*_entity|.*_entities|entity_id|entity_ids|start_entity|stop_entity)$/;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const ENTITY_DOMAINS = new Set('sensor binary_sensor switch select number button calendar climate person device_tracker zone input_number input_boolean input_datetime input_text input_select update light fan lock cover automation script weather notify'.split(' '));
function redact(input) {
  const ids = new Map();
  const anon = (value) => {
    if (!ids.has(value)) {
      const prefix = ENTITY.test(value) ? value.split('.')[0] : '';
      const domain = ENTITY_DOMAINS.has(prefix) ? prefix + '.' : '';
      ids.set(value, domain + 'anonymous_' + (ids.size + 1));
    }
    return ids.get(value);
  };
  const walk = (value, key = '') => {
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 2000).map((v) => walk(v, key));
    if (typeof value === 'object') {
      if (key === 'result') return Object.fromEntries(Object.entries(value).map(([id, item]) => [anon(id), walk(item)]));
      const out = {};
      for (const [k, v] of Object.entries(value)) if (KEYS.has(k)) out[k] = walk(v, k);
      return out;
    }
    if (typeof value !== 'string') return null;
    if (key === 'signature') return '[omitted]';
    if (ID.test(key) || ['connected_id', 'chosen', 'order', 'candidates', 'chargers'].includes(key)) return anon(value);
    if (key === 'service') return SERVICES.has(value) ? value : value.startsWith('notify.') ? anon(value) : '[service omitted]';
    if (ENTITY.test(value)) return anon(value);
    if (['app_version', 'ha_version'].includes(key)) return /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?$/.test(value) ? value : '[omitted]';
    if (['at', 'start', 'end', 'time', 'until', 'generated_at', 'computed_at', 'last_changed', 'last_updated', 'last_reported'].includes(key)
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
    if (['state', 'value', 'soc'].includes(key) && /^-?\d+(?:\.\d+)?$/.test(value)) return value;
    if (key === 'unit_of_measurement' && /^(?:[A-Z]{3}|[€£$]|ct)\/(?:kWh|MWh)$/.test(value)) return value;
    if (SAFE.has(value)) return value;
    return '[text omitted]';
  };
  const result = input && typeof input === 'object' && !Array.isArray(input) ? walk(input) : {};
  result.format = 'smart-charging-planner-public-diagnostics';
  result.schema_version = 2;
  result.privacy = { identifiers: 'pseudonyms per export', free_text: 'omitted', raw_logs: 'omitted' };
  const logs = input && Array.isArray(input.app_log) ? input.app_log : [];
  result.app_log_summary = { lines: logs.length, errors: logs.filter((l) => /error|failed|refused/i.test(String(l))).length };
  return result;
}
function redactLine() { return '[log text omitted]'; }
module.exports = { redact, redactLine };
