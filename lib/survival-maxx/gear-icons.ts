// Inline SVG glyphs for the gear expansion. Weapons share the 64x64 side-view
// silhouette language of `WEAPON_ICONS` in ui.ts (stroke 2.4); items and
// drones use the 24x24 line-icon language of `ICONS` (stroke 1.7). ui.ts
// spreads these maps into its own so `uiIcon(id)` resolves every new id.

export const EXPANSION_WEAPON_ICONS: Record<string, string> = {
  pinball:
    '<path d="M12 34h34v12H34l-7 13H15l6-13M46 37h12v6H46M22 34v-4"/><circle cx="30" cy="23" r="9"/><circle class="icon-fill" cx="30" cy="23" r="3"/>',
  thumper:
    '<path d="M10 33h30v12H31l-7 13H12l6-13M40 39h10"/><path d="M50 27h6v24h-6ZM20 33v-8h14v8M53 33h3m-3 12h3"/>',
  mortar:
    '<path d="M12 40h20v10H26l-6 11H12l5-11"/><path d="m28 40 18-24 9 6-14 21M31 36l8 6"/><path d="m36 44-8 16m14-16 6 16"/>',
  flare:
    '<path d="m14 33 5-9h28v14H36l-8 17H17l6-17Z"/><path d="M47 26h10v12H47M28 41v8h-7"/><path d="M30 42h8v9h-8Z"/>',
  skyfall:
    '<path d="M14 36h20v10H30l-6 12H15l5-12M34 41h8"/><path d="M42 20c10 0 16 8 16 20s-6 20-16 20M42 20v40M48 40h8"/><circle class="icon-fill" cx="58" cy="40" r="3"/>',
  tesla_orb:
    '<path d="M12 35h24v10H32l-6 13H14l5-13M36 33l10-8m-10 18 10 8"/><circle cx="50" cy="40" r="8"/><path d="m40 32 4 3m-4 13 4-3"/>',
  halo: '<path d="M12 36h20v10H28l-6 13H14l5-13M32 41h6"/><circle cx="46" cy="34" r="14"/><circle cx="46" cy="34" r="6"/>',
  gravity:
    '<path d="m12 34 6-8h24v12H32l-6 15H15l6-15M42 30h16v8H42"/><ellipse cx="46" cy="34" rx="3" ry="9"/><ellipse cx="52" cy="34" rx="3" ry="9"/><ellipse cx="58" cy="34" rx="3" ry="9"/>',
  spore_mine:
    '<path d="M12 36h30v10H30l-6 13H14l5-13M42 39h12v5H42"/><rect x="18" y="20" width="18" height="16" rx="3"/><circle cx="44" cy="52" r="5"/><path d="M44 44v3m-6 5h-3m18 0h-3m-6 3v3"/>',
  hive: '<path d="M12 38h14v8H24l-6 12H13l5-12M26 40h6"/><path d="m32 22 14-8 14 8v16l-14 8-14-8Z"/><path d="m40 30 6-3 6 3v7l-6 3-6-3Z"/>',
  sentry:
    '<path d="M20 44h10v8H28l-4 8H20l3-8M30 46h6"/><path d="M36 22h16l4 6v10H36ZM40 38l-6 16m14-16 6 16M44 38v16M52 26h4"/>',
  shatter:
    '<path d="m10 34 6-8h28v12H34l-6 15H14l6-15M44 30h8l8 4-8 4h-8"/><path d="m26 23 6-8 6 8-6 3Z"/><path d="M26 23h12"/>',
  eclipse:
    '<path d="m8 36 6-8h22v12H30l-6 15H11l6-15M36 30h14v8H36"/><circle cx="52" cy="34" r="9"/><circle class="icon-fill" cx="56" cy="34" r="4"/><path d="M14 22h16M18 18h8"/>',
};

export const EXPANSION_ITEM_ICONS: Record<string, string> = {
  ricochet:
    '<path d="m4 18 6-10 6 6 4-8"/><circle class="gem-face" cx="20" cy="6" r="1.5"/><path d="M4 18h3m-3 0v-3"/>',
  split_shot:
    '<path d="M12 21V12M12 12 5 4m7 8 7-8M5 4h4M5 4v4m10-4h4m0 0v4"/>',
  splash:
    '<path d="M12 3c-3 5-6 8-6 12a6 6 0 0 0 12 0c0-4-3-7-6-12Z"/><path d="M3 21c3-2 6 2 9 0s6-2 9 0"/>',
  homing:
    '<circle cx="12" cy="12" r="8"/><path d="m8 12 4-4 4 4-4 4Z"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>',
  lifesteal:
    '<path d="M12 20 4.6 12.6C-.5 7.5 6.9 1 12 7c5.1-6 12.5.5 7.4 5.6Z"/><path d="m12 20 3-4-2-2 2-3"/>',
  double_shot: '<path d="M6 21V9l2.5-5L11 9v12ZM13 21V9l2.5-5L18 9v12Z"/>',
  pierce:
    '<path d="m3 21 14-14"/><path d="m13 5 6-2-2 6"/><path d="M8 8h8v8H8Z"/>',
  crit_damage:
    '<path d="m12 2 2 6 6 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1Z"/><path d="M12 9v4"/>',
  crit_chance:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  attack_range: '<path d="M3 12h13M16 9h5v6h-5ZM3 9v6M7 10v4m4-4v4"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m12 8 3 2v4l-3 2-3-2v-4Z"/>',
  knockback:
    '<path d="M5 5h5v14H5Z"/><path d="m10 12 5-4v8Z"/><path d="m17 9 3 3-3 3"/>',
  status_damage:
    '<path d="M9 3h6M10 3v5l-5 8a3 3 0 0 0 3 5h8a3 3 0 0 0 3-5l-5-8V3"/><path d="M7 16h10"/>',
  slow_power:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v4m0 12v4M4 7l3.5 2m9 5 3.5 2M4 17l3.5-2m9-5L20 7"/>',
  momentum:
    '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-60 12 12)"/>',
  thorns:
    '<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 9 1-3 1 3m2 0 1-3 1 3m-6 5 1-3 1 3m2 0 1-3 1 3"/>',
  interest:
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>',
  discount:
    '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4Z"/><path d="m9 15 6-6"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/>',
  free_reroll:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/>',
  luck: '<circle cx="12" cy="7" r="3.5"/><circle cx="17" cy="12" r="3.5"/><circle cx="12" cy="17" r="3.5"/><circle cx="7" cy="12" r="3.5"/><path d="m11 22 1-5"/>',
  second_chance:
    '<path d="M4 8h16v12H4Z"/><path d="M9 8V5h6v3"/><path d="M12 17 8.5 13.5A2 2 0 0 1 12 11a2 2 0 0 1 3.5 2.5Z"/>',
  torch_drone:
    '<path d="m12 3 6 3v6l-6 4-6-4V6Z"/><path d="M6 9H2m20 0h-4M8 3 5 1m14 2 3-2"/><path d="M12 17c-2 2-2 4 0 6 2-2 2-4 0-6Z"/>',
  frost_drone:
    '<path d="m12 3 6 3v6l-6 4-6-4V6Z"/><path d="M6 9H2m20 0h-4M8 3 5 1m14 2 3-2"/><path d="M12 17v6m-2.5-4.5 5 3m0-3-5 3"/>',
  mortar_drone:
    '<path d="m12 3 6 3v6l-6 4-6-4V6Z"/><path d="M6 9H2m20 0h-4M8 3 5 1m14 2 3-2"/><path d="m11 22 4-5 3 2-4 4Z"/><path d="M8 22h3"/>',
  aegis_drone:
    '<path d="m12 3 6 3v6l-6 4-6-4V6Z"/><path d="M6 9H2m20 0h-4M8 3 5 1m14 2 3-2"/><path d="M5 18c2 4 12 4 14 0"/>',
  venom_drone:
    '<path d="m12 3 6 3v6l-6 4-6-4V6Z"/><path d="M6 9H2m20 0h-4M8 3 5 1m14 2 3-2"/><path d="M9 17v3m3-3v5m3-5v3"/>',
};
