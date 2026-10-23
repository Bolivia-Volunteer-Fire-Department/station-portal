#!/usr/bin/env node
/**
 * Seeds a rich, screenshot- and demonstration-ready Fire Department ("Harborview Fire & Rescue")
 * into either a live Demo Firebase Project (default: `demo` in departments.json) or the local
 * Firebase Emulators (`--emulator`).
 *
 * Usage:
 *   npm run dept:seed-demo                     # Seeds the "demo" department in departments.json
 *   npm run dept:seed-demo -- --emulator       # Seeds the running local Firebase Emulators
 *   npm run dept:seed-demo -- --dept demo      # Explicit department slug
 *
 * All schedule dates, clock logs, trainings, and events are generated relative to TODAY, so running
 * this script before a live demo or screenshot session guarantees a vibrant, up-to-date calendar and
 * status board.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  DEMO_BACKDROP_GEOJSON,
  DEMO_BOUNDARY_GEOJSON,
  DEMO_DISTRICT_HEIGHT,
  DEMO_DISTRICT_SVG,
  DEMO_DISTRICT_WIDTH,
} from './seed-emulator.mjs';
import { MAP_BACKDROP_FIELDS, MAP_BACKDROP_LAYERS, MAP_BACKDROP_STYLE, backdropDocument, boundaryDocument } from '../src/utils/districtMap.js';
import { DEFAULT_MAP_TYPES, MAP_TYPES_DOC_ID, mapTypesDocument } from '../src/utils/mapTypes.js';

const ROOT = resolve(import.meta.dirname, '..');
const DEPARTMENTS_PATH = resolve(ROOT, 'departments.json');

export const DEMO_LOGIN_PASSWORD = 'DemoStation1!';

const PERMISSION_FLAGS = [
  'can_access_debug',
  'can_administer_trainings',
  'can_approve_shifts',
  'can_create_events',
  'can_edit_assignments',
  'can_edit_availability_windows',
  'can_edit_member_availability',
  'can_edit_notification_settings',
  'can_edit_own_availability',
  'can_edit_ranks',
  'can_edit_roles',
  'can_edit_schedule',
  'can_edit_schedule_template',
  'can_edit_schedule_templates',
  'can_edit_system_settings',
  'can_edit_timeclock',
  'can_edit_trainings',
  'can_edit_users',
  'can_make_announcements',
  'can_make_offers',
  'can_manage_certification_setup',
  'can_manage_certifications',
  'can_manage_documents',
  'can_sign_trainings',
  'can_use_timeclock',
  'can_verify_documents',
  'can_add_assessment_scores',
  'can_view_certifications',
  'can_view_documents',
  'can_view_full_schedule',
  'can_view_my_schedule',
  'can_view_roster',
];

const roleRow = (description, isAdmin, granted = []) => ({
  description,
  is_admin: isAdmin,
  ...Object.fromEntries(PERMISSION_FLAGS.map((flag) => [flag, isAdmin || granted.includes(flag)])),
});

const docValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(docValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, docValue(v)])) },
    };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
};

const pad2 = (n) => String(n).padStart(2, '0');

const formatYmd = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const addDays = (baseDate, days) => {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
};

const getFirebaseCliAccessToken = () => {
  const configPath = resolve(homedir(), '.config/configstore/firebase-tools.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'Firebase CLI credentials not found at ~/.config/configstore/firebase-tools.json. Run "npx firebase login" first.'
    );
  }
  const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  const token = parsed && parsed.tokens && parsed.tokens.access_token;
  if (!token) {
    throw new Error('No access_token found in Firebase CLI configstore. Run "npx firebase projects:list" to refresh it.');
  }
  return token;
};

const resolveTarget = () => {
  const args = process.argv.slice(2);
  const usingEmulator = args.includes('--emulator');
  if (usingEmulator) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-station-portal';
    return {
      usingEmulator: true,
      projectId,
      firestoreBase: `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`,
      authBase: `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
      token: 'owner',
    };
  }

  const deptIdx = args.indexOf('--dept');
  const slug = deptIdx >= 0 && args[deptIdx + 1] ? args[deptIdx + 1] : 'demo';

  const registry = existsSync(DEPARTMENTS_PATH)
    ? JSON.parse(readFileSync(DEPARTMENTS_PATH, 'utf8'))
    : { departments: {} };
  const dept = registry.departments && registry.departments[slug];

  if (!dept) {
    throw new Error(`Department "${slug}" not found in departments.json.`);
  }
  if (!dept.isDemo || dept.projectId === 'fire-clock-76723') {
    throw new Error(
      `SAFETY REFUSAL: Department "${slug}" (${dept.projectId}) is not marked with "isDemo": true in departments.json.\n` +
        `This script only seeds designated demo projects so production departments can never be overwritten.`
    );
  }

  const token = getFirebaseCliAccessToken();
  return {
    usingEmulator: false,
    projectId: dept.projectId,
    firestoreBase: `https://firestore.googleapis.com/v1/projects/${dept.projectId}/databases/(default)/documents`,
    authBase: `https://identitytoolkit.googleapis.com/v1/projects/${dept.projectId}/accounts`,
    token,
  };
};

export const seedDemoDepartment = async () => {
  const target = resolveTarget();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${target.token}`,
    ...(target.usingEmulator ? {} : { 'x-goog-user-project': target.projectId }),
  };

  const put = async (path, data) => {
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, docValue(v)]));
    const res = await fetch(`${target.firestoreBase}/${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      throw new Error(`Failed writing ${path} (${res.status}): ${await res.text()}`);
    }
  };

  const createAccount = async ({ uid, username, role, isAdmin }) => {
    const email = `${username}@boliviavfd.invalid`;
    const res = await fetch(target.authBase, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        localId: uid,
        email,
        password: DEMO_LOGIN_PASSWORD,
        emailVerified: true,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      if (!txt.includes('EMAIL_EXISTS') && !txt.includes('DUPLICATE_LOCAL_ID')) {
        throw new Error(`Failed creating Auth user ${email} (${res.status}): ${txt}`);
      }
      // Ensure password is set to DEMO_LOGIN_PASSWORD if account already existed
      await fetch(`${target.authBase}:update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ localId: uid, password: DEMO_LOGIN_PASSWORD }),
      });
    }
    await fetch(`${target.authBase}:update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        localId: uid,
        customAttributes: JSON.stringify({ role_id: role, is_admin: isAdmin }),
      }),
    });
  };

  console.log(`\nSeeding Demo Fire Department into "${target.projectId}" (${target.usingEmulator ? 'EMULATOR' : 'CLOUD'})...`);

  const today = new Date();
  const todayStr = formatYmd(today);
  const currentMonth = todayStr.slice(0, 7);

  // 1. Settings
  const demoShieldSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#dc2626"/><stop offset="100%" stop-color="#991b1b"/></linearGradient></defs>',
    '<circle cx="120" cy="120" r="112" fill="#0f172a" stroke="#f59e0b" stroke-width="8"/>',
    '<circle cx="120" cy="120" r="96" fill="url(#g)" stroke="#fef3c7" stroke-width="3"/>',
    '<path d="M120 34 L145 78 L186 54 L162 95 L206 120 L162 145 L186 186 L145 162 L120 206 L95 162 L54 186 L78 145 L34 120 L78 95 L54 54 L95 78 Z" fill="#fef3c7" stroke="#0f172a" stroke-width="4" stroke-linejoin="round"/>',
    '<circle cx="120" cy="120" r="42" fill="#0f172a" stroke="#f59e0b" stroke-width="4"/>',
    '<text x="120" y="114" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="22" fill="#ffffff">HFR</text>',
    '<text x="120" y="136" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="13" fill="#f59e0b">STA 1</text>',
    '</svg>',
  ].join('');
  const demoLogoDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(demoShieldSvg)}`;

  await put('settings/public', {
    department_name: 'Harborview Fire & Rescue',
    department_logo_url: demoLogoDataUrl,
    forgot_password_enabled: 'true',
  });
  await put('settings/private', {
    clock_location_radius_m: 300,
    station_lat: 34.0522,
    station_lng: -78.145,
  });

  // 2. Roles
  await put('roles/r_admin', roleRow('Chief / Administrator', true));
  await put(
    'roles/r_officer',
    roleRow('Company Officer', false, [
      'can_use_timeclock',
      'can_view_my_schedule',
      'can_view_full_schedule',
      'can_view_roster',
      'can_edit_own_availability',
      'can_edit_member_availability',
      'can_make_offers',
      'can_approve_shifts',
      'can_edit_schedule',
      'can_view_documents',
      'can_manage_documents',
      'can_verify_documents',
      'can_view_certifications',
      'can_manage_certifications',
      'can_sign_trainings',
      'can_edit_trainings',
      'can_administer_trainings',
      'can_make_announcements',
      'can_create_events',
      'can_add_assessment_scores',
    ])
  );
  await put(
    'roles/r_member',
    roleRow('Firefighter / EMT', false, [
      'can_use_timeclock',
      'can_view_my_schedule',
      'can_view_full_schedule',
      'can_view_roster',
      'can_edit_own_availability',
      'can_make_offers',
      'can_view_documents',
      'can_view_certifications',
      'can_sign_trainings',
    ])
  );

  // 3. Ranks
  const ranks = [
    { id: 'rk_chief', description: 'Fire Chief', rank_order: 6, color: '#dc2626', icon: 'shield' },
    { id: 'rk_capt', description: 'Captain', rank_order: 5, color: '#ea580c', icon: 'shield' },
    { id: 'rk_lt', description: 'Lieutenant', rank_order: 4, color: '#d97706', icon: 'award' },
    { id: 'rk_eng', description: 'Engineer', rank_order: 3, color: '#2563eb', icon: 'wrench' },
    { id: 'rk_ff', description: 'Firefighter / EMT', rank_order: 2, color: '#16a34a', icon: 'flame' },
    { id: 'rk_prob', description: 'Probationary FF', rank_order: 1, color: '#64748b', icon: 'user' },
  ];
  for (const r of ranks) {
    await put(`ranks/${r.id}`, {
      description: r.description,
      rank_order: r.rank_order,
      color: r.color,
      icon: r.icon,
    });
  }

  // 4. Roster Members (10 personnel)
  const members = [
    { uid: 'demo_u1', username: 'admin', name: 'Chief Alex Carter', rank: 'rk_chief', role: 'r_admin', isAdmin: true, email: 'acarter@harborviewfd.example', phone: '910-555-0101' },
    { uid: 'demo_u2', username: 'jchen', name: 'Capt. Jordan Chen', rank: 'rk_capt', role: 'r_officer', isAdmin: false, email: 'jchen@harborviewfd.example', phone: '910-555-0102' },
    { uid: 'demo_u3', username: 'mrodriguez', name: 'Lt. Maya Rodriguez', rank: 'rk_lt', role: 'r_officer', isAdmin: false, email: 'mrodriguez@harborviewfd.example', phone: '910-555-0103' },
    { uid: 'demo_u4', username: 'tbrooks', name: 'Eng. Tyler Brooks', rank: 'rk_eng', role: 'r_member', isAdmin: false, email: 'tbrooks@harborviewfd.example', phone: '910-555-0104' },
    { uid: 'demo_u5', username: 'lmorgan', name: 'Eng. Luke Morgan', rank: 'rk_eng', role: 'r_member', isAdmin: false, email: 'lmorgan@harborviewfd.example', phone: '910-555-0105' },
    { uid: 'demo_u6', username: 'kpatel', name: 'FF Kiran Patel', rank: 'rk_ff', role: 'r_member', isAdmin: false, email: 'kpatel@harborviewfd.example', phone: '910-555-0106' },
    { uid: 'demo_u7', username: 'sreed', name: 'FF Sam Reed', rank: 'rk_ff', role: 'r_member', isAdmin: false, email: 'sreed@harborviewfd.example', phone: '910-555-0107' },
    { uid: 'demo_u8', username: 'hbennett', name: 'FF Hannah Bennett', rank: 'rk_ff', role: 'r_member', isAdmin: false, email: 'hbennett@harborviewfd.example', phone: '910-555-0108' },
    { uid: 'demo_u9', username: 'cdavis', name: 'FF Caleb Davis', rank: 'rk_ff', role: 'r_member', isAdmin: false, email: 'cdavis@harborviewfd.example', phone: '910-555-0109' },
    { uid: 'demo_u10', username: 'ewilson', name: 'FF Emma Wilson', rank: 'rk_prob', role: 'r_member', isAdmin: false, email: 'ewilson@harborviewfd.example', phone: '910-555-0110' },
  ];

  for (const m of members) {
    await createAccount(m);
    await put(`users/${m.uid}`, {
      name: m.name,
      rank_id: m.rank,
      role_id: m.role,
    });
    await put(`users_private/${m.uid}`, {
      username: m.username,
      email: m.email,
      phone: m.phone,
      status: 'active',
      created_at: '2026-01-01 08:00:00',
    });
    await put(`user_settings/${m.uid}`, {
      time_format: '24',
      is_dark_mode: false,
    });
  }

  // 5. Apparatus & Duty Assignments
  const assignments = [
    { id: 'as_cmd', description: 'Duty Officer (Command)', color: '#dc2626', icon: 'shield', rank_order_required: 4 },
    { id: 'as_eng1_drv', description: 'Engine 1 — Driver/Operator', color: '#2563eb', icon: 'truck', rank_order_required: 3 },
    { id: 'as_eng1_ff', description: 'Engine 1 — Nozzle / Crew', color: '#ef4444', icon: 'flame', rank_order_required: 1 },
    { id: 'as_lad1', description: 'Ladder 1 — Aerial Crew', color: '#d97706', icon: 'wrench', rank_order_required: 2 },
    { id: 'as_res1', description: 'Rescue 1 — Medic / EMS', color: '#0d9488', icon: 'heart-pulse', rank_order_required: 2 },
  ];
  for (const a of assignments) {
    await put(`assignments/${a.id}`, a);
  }

  // 6. Schedule Templates & Current Week / Month Shifts
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let templateIdx = 1;
  for (const dayName of dayNames) {
    await put(`schedule_templates/dt_${templateIdx++}`, {
      day_of_week: dayName,
      start_time: '08:00',
      end_time: '20:00',
      assignment_id: 'as_cmd',
      nickname: 'Day Command',
    });
    await put(`schedule_templates/dt_${templateIdx++}`, {
      day_of_week: dayName,
      start_time: '08:00',
      end_time: '20:00',
      assignment_id: 'as_eng1_drv',
      nickname: 'Engine 1 Day Driver',
    });
    await put(`schedule_templates/dt_${templateIdx++}`, {
      day_of_week: dayName,
      start_time: '08:00',
      end_time: '20:00',
      assignment_id: 'as_eng1_ff',
      nickname: 'Engine 1 Day Crew',
    });
    await put(`schedule_templates/dt_${templateIdx++}`, {
      day_of_week: dayName,
      start_time: '20:00',
      end_time: '08:00',
      assignment_id: 'as_eng1_ff',
      nickname: 'Night Duty Crew',
    });
  }

  let shiftSeq = 1;
  for (let offset = -5; offset <= 14; offset += 1) {
    const d = addDays(today, offset);
    const dStr = formatYmd(d);
    const officerUid = offset % 2 === 0 ? 'demo_u2' : 'demo_u3';
    const driverUid = offset % 2 === 0 ? 'demo_u4' : 'demo_u5';
    const crewUid = ['demo_u6', 'demo_u7', 'demo_u8', 'demo_u9'][Math.abs(offset) % 4];
    const isOpenSlot = offset === 2 || offset === 5;

    await put(`schedule/demo_s_${shiftSeq++}`, {
      schedule_template_id: 'dt_1',
      assignment_id: 'as_cmd',
      user_id: officerUid,
      date_from: dStr,
      date_to: dStr,
      start_time: '08:00',
      end_time: '20:00',
      is_open: false,
    });

    await put(`schedule/demo_s_${shiftSeq++}`, {
      schedule_template_id: 'dt_2',
      assignment_id: 'as_eng1_drv',
      user_id: driverUid,
      date_from: dStr,
      date_to: dStr,
      start_time: '08:00',
      end_time: '20:00',
      is_open: false,
    });

    const crewShiftId = `demo_s_${shiftSeq++}`;
    await put(`schedule/${crewShiftId}`, {
      schedule_template_id: 'dt_3',
      assignment_id: 'as_eng1_ff',
      user_id: isOpenSlot ? '' : crewUid,
      date_from: dStr,
      date_to: dStr,
      start_time: '08:00',
      end_time: '20:00',
      is_open: isOpenSlot,
    });

    if (offset === 2) {
      await put('schedule_offers/demo_of1', {
        user_id: 'demo_u7',
        schedule_id: crewShiftId,
        date_from: dStr,
        assignment_id: 'as_eng1_ff',
        status: 'pending',
        slot_key: `${dStr}|as_eng1_ff`,
      });
    }
  }

  // 7. On-Duty Crew & Recent Timeclock Entries
  const onDutyMembers = [
    { uid: 'demo_u2', name: 'Capt. Jordan Chen', rank: 'rk_capt', timeIn: `${todayStr} 07:52` },
    { uid: 'demo_u4', name: 'Eng. Tyler Brooks', rank: 'rk_eng', timeIn: `${todayStr} 07:56` },
    { uid: 'demo_u6', name: 'FF Kiran Patel', rank: 'rk_ff', timeIn: `${todayStr} 07:58` },
  ];
  for (const od of onDutyMembers) {
    await put(`on_duty/${od.uid}`, {
      user_id: od.uid,
      name: od.name,
      rank_id: od.rank,
      time_in: od.timeIn,
    });
    await put(`timeclock/tc_live_${od.uid}`, {
      user_id: od.uid,
      time_in: od.timeIn,
      time_out: '',
      is_manual: false,
    });
  }

  for (let i = 1; i <= 6; i += 1) {
    const pastStr = formatYmd(addDays(today, -i));
    await put(`timeclock/tc_hist_${i}_a`, {
      user_id: 'demo_u3',
      time_in: `${pastStr} 08:00`,
      time_out: `${pastStr} 20:00`,
      is_manual: false,
    });
    await put(`timeclock/tc_hist_${i}_b`, {
      user_id: 'demo_u6',
      time_in: `${pastStr} 08:00`,
      time_out: `${pastStr} 20:00`,
      is_manual: false,
    });
  }

  // 8. Certifications & Badges
  const certTypes = [
    { id: 'ct_ff2', name: 'Firefighter II', icon: 'flame', show_on_roster: true, sort_order: 1, warn_days_before: 60, is_renewable: false },
    { id: 'ct_emt', name: 'EMT-Basic', icon: 'heart-pulse', show_on_roster: true, sort_order: 2, warn_days_before: 60, is_renewable: true },
    { id: 'ct_drv', name: 'Driver / Operator — Pumps', icon: 'truck', show_on_roster: true, sort_order: 3, warn_days_before: 60, is_renewable: true },
    { id: 'ct_haz', name: 'HazMat Operations', icon: 'Biohazard', show_on_roster: true, sort_order: 4, warn_days_before: 45, is_renewable: true },
    { id: 'ct_fo1', name: 'Fire Officer I', icon: 'shield', show_on_roster: true, sort_order: 5, warn_days_before: 90, is_renewable: false },
  ];
  for (const ct of certTypes) {
    await put(`certification_setup/${ct.id}`, ct);
  }

  const nextYearStr = formatYmd(addDays(today, 320));
  const expiringSoonStr = formatYmd(addDays(today, 24));
  let certSeq = 1;
  for (const m of members.slice(0, 8)) {
    const badges = [
      { id: 'ct_ff2', name: 'Firefighter II', icon: 'flame' },
      { id: 'ct_emt', name: 'EMT-Basic', icon: 'heart-pulse' },
    ];
    await put(`certifications/demo_cr_${certSeq++}`, {
      user_id: m.uid,
      certification_id: 'ct_ff2',
      effective_date: '2023-05-15',
      end_date: '',
      notes: 'IFSAC / ProBoard Certified',
      updated_at: `${todayStr} 08:00:00`,
      has_upload: false,
    });
    await put(`certifications/demo_cr_${certSeq++}`, {
      user_id: m.uid,
      certification_id: 'ct_emt',
      effective_date: '2025-01-10',
      end_date: m.uid === 'demo_u7' ? expiringSoonStr : nextYearStr,
      notes: 'State OEMS Registry',
      updated_at: `${todayStr} 08:00:00`,
      has_upload: false,
    });
    if (['rk_chief', 'rk_capt', 'rk_lt'].includes(m.rank)) {
      badges.push({ id: 'ct_fo1', name: 'Fire Officer I', icon: 'shield' });
      await put(`certifications/demo_cr_${certSeq++}`, {
        user_id: m.uid,
        certification_id: 'ct_fo1',
        effective_date: '2022-09-01',
        end_date: '',
        notes: 'NC OSFM Fire Officer I',
        updated_at: `${todayStr} 08:00:00`,
        has_upload: false,
      });
    }
    if (['rk_eng', 'rk_capt'].includes(m.rank)) {
      badges.push({ id: 'ct_drv', name: 'Driver / Operator — Pumps', icon: 'truck' });
      await put(`certifications/demo_cr_${certSeq++}`, {
        user_id: m.uid,
        certification_id: 'ct_drv',
        effective_date: '2024-03-20',
        end_date: nextYearStr,
        notes: 'Emergency Vehicle Driver & Pump Ops',
        updated_at: `${todayStr} 08:00:00`,
        has_upload: false,
      });
    }
    await put(`certification_badges/${m.uid}`, {
      user_id: m.uid,
      badges,
    });
  }

  // 9. Trainings & Signatures
  const trainings = [
    {
      id: 'demo_tr1',
      title: 'NFPA 1410 Evolution — Forward Lay & Standpipe Operations',
      date: formatYmd(addDays(today, -6)),
      hours: 3,
      instructor: 'Capt. Jordan Chen',
      description: 'Company evolution focusing on 200ft preconnect deployment, supply line establish, and engine pressure calculations.',
      is_fire_facility: true,
      is_company_training: true,
      is_entered_into_external: false,
      signature_count: 6,
    },
    {
      id: 'demo_tr2',
      title: 'SCBA Confidence Course & Mayday / RIT Bailout Practical',
      date: formatYmd(addDays(today, -2)),
      hours: 4,
      instructor: 'Lt. Maya Rodriguez',
      description: 'Low-visibility entanglement props, air management drills, LUNAR radio report, and Rapid Intervention Team packaging.',
      is_fire_facility: true,
      is_hazmat_training: false,
      is_entered_into_external: false,
      signature_count: 5,
    },
    {
      id: 'demo_tr3',
      title: 'Pump Operations, Drafting & Relay Pumping',
      date: formatYmd(addDays(today, 3)),
      hours: 3,
      instructor: 'Eng. Tyler Brooks',
      description: 'Static water source drafting at Harborview Marina ramp using portable tank and 1,500 GPM pumper.',
      is_driver_training: true,
      is_company_training: true,
      is_entered_into_external: false,
      signature_count: 0,
    },
  ];
  for (const tr of trainings) {
    await put(`trainings/${tr.id}`, tr);
  }
  for (const uid of ['demo_u2', 'demo_u3', 'demo_u4', 'demo_u6', 'demo_u7', 'demo_u8']) {
    await put(`training_signatures/demo_ts1_${uid}`, {
      training_id: 'demo_tr1',
      user_id: uid,
      signed_at: `${formatYmd(addDays(today, -6))} 21:15:00`,
    });
  }

  // 10. Announcements, Events, and SOP Documents
  await put('announcements/demo_an1', {
    title: 'Annual Hose & Ladder Testing This Saturday (0800)',
    content:
      'All on-duty and available off-duty personnel please report to **Station 1 Apron** by `08:00` Saturday for annual NFPA 1962 service testing on Engine 1 and Ladder 1.',
    audience_keys: ['*'],
    is_visible_on_dashboard: true,
    created_at: `${todayStr} 08:00:00`,
    live_until: '9999-12-31',
  });
  await put('announcements/demo_an2', {
    title: 'Updated Coastal Pre-Incident Plans Published',
    content:
      'New pre-incident diagrams and hydrant flow data for **Harborview Marina** and **Seaside Elementary** are now live under Documents and the District Map.',
    audience_keys: ['*'],
    is_visible_on_dashboard: true,
    created_at: `${todayStr} 09:30:00`,
    live_until: '9999-12-31',
  });

  await put('events/demo_ev1', {
    title: 'Monthly Officer & Training Staff Meeting',
    date_from: formatYmd(addDays(today, 2)),
    date_to: formatYmd(addDays(today, 2)),
    start_time: '19:00',
    end_time: '21:00',
    location: 'Station 1 Classroom',
    audience_keys: ['*'],
  });
  await put('events/demo_ev2', {
    title: 'Annual NFPA 1962 Hose & Appliance Service Testing',
    date_from: formatYmd(addDays(today, 5)),
    date_to: formatYmd(addDays(today, 5)),
    start_time: '08:00',
    end_time: '15:00',
    location: 'Station 1 Rear Training Pad',
    audience_keys: ['*'],
  });

  await put('documents/demo_doc1', {
    title: 'SOP 201 — First-Due Engine Company Operations',
    category: 'Standard Operating Procedures',
    content: [
      '# SOP 201: First-Due Engine Company Operations',
      '',
      '## 1. Purpose & Scope',
      'Establishes standard arrival positioning, water supply benchmarks, and initial size-up reports for the first-arriving engine company on structure fire assignments.',
      '',
      '## 2. Initial Size-Up Report (CAN / BIR)',
      '- **Unit Identifier** confirming arrival on scene',
      '- **Building Description** (height, occupancy type, construction)',
      '- **Conditions Found** (working fire, smoke showing, nothing showing)',
      '- **Actions Taken** (offensive attack, 360° recon, establishing command)',
      '',
      '## 3. Water Supply Benchmarks',
      '1. Spot apparatus with three sides of the structure visible where possible, leaving the front apron clear for **Ladder 1**.',
      '2. Lay 5" LDH supply line from the nearest Class AA or Class A hydrant when smoke or fire is visible on arrival.',
    ].join('\n'),
    audience_keys: ['*'],
    content_revision: 1,
    is_published: true,
    doc_type: 'document',
    is_sign_required: true,
    updated_at: `${todayStr} 08:00:00`,
  });

  await put('documents/demo_doc2', {
    title: 'Daily Apparatus & Equipment Readiness Checklist',
    category: 'Checklists',
    content: 'Complete each item at the start of the 0800 shift change.',
    audience_keys: ['*'],
    content_revision: 1,
    is_published: true,
    doc_type: 'checklist',
    is_sign_required: true,
    updated_at: `${todayStr} 08:00:00`,
  });
  await put('document_checklist_items/demo_chk1', {
    document_id: 'demo_doc2',
    audience_keys: ['*'],
    sort_order: 1,
    section: 'Cab & SCBA',
    label: 'All 4 riding positions SCBA cylinders >= 4,200 PSI & PASS verified',
  });
  await put('document_checklist_items/demo_chk2', {
    document_id: 'demo_doc2',
    audience_keys: ['*'],
    sort_order: 2,
    section: 'Pump & Tank',
    label: 'Booster tank full (750 gal), primer & tank-to-pump valves exercised',
  });

  // 11. Availability Windows & Claims for Current Month
  await put('availability_windows/demo_aw1', {
    nickname: 'Day Shift (0800-2000)',
    start_time: '08:00',
    end_time: '20:00',
    is_monday: true,
    is_tuesday: true,
    is_wednesday: true,
    is_thursday: true,
    is_friday: true,
    is_saturday: true,
    is_sunday: true,
    effective_date: '2026-01-01',
    end_date: '',
  });
  await put(`availability_months/demo_u6_${currentMonth}`, {
    user_id: 'demo_u6',
    month: currentMonth,
    claims: {
      demo_aw1: [formatYmd(addDays(today, 1)), formatYmd(addDays(today, 3)), formatYmd(addDays(today, 6))],
    },
  });

  // 12. District Map Boundary, Backdrops & Hydrant Landmarks
  await put('map_layers/district', {
    svg: DEMO_DISTRICT_SVG,
    width: DEMO_DISTRICT_WIDTH,
    height: DEMO_DISTRICT_HEIGHT,
    view_box: `0 0 ${DEMO_DISTRICT_WIDTH} ${DEMO_DISTRICT_HEIGHT}`,
    created_at: `${todayStr} 08:00:00`,
    created_by: 'seed',
    updated_at: `${todayStr} 08:00:00`,
    updated_by: 'seed',
  });
  await put('map_boundaries/district', {
    ...boundaryDocument(DEMO_BOUNDARY_GEOJSON, {
      label: 'Harborview Fire District 1',
      zone: '1',
      source: 'Harborview GIS Demo Boundary',
    }),
    updated_at: `${todayStr} 08:00:00`,
    saved_by: 'seed',
  });
  await put(`map_types/${MAP_TYPES_DOC_ID}`, {
    ...mapTypesDocument(DEFAULT_MAP_TYPES, { author: 'seed' }),
    updated_at: `${todayStr} 08:00:00`,
  });
  for (const layer of MAP_BACKDROP_LAYERS) {
    await put(`map_backdrops/${layer}`, {
      ...backdropDocument(DEMO_BACKDROP_GEOJSON[layer], {
        layer,
        label: `${MAP_BACKDROP_STYLE[layer].label}`,
        source: 'Harborview GIS',
        fields: MAP_BACKDROP_FIELDS[layer],
      }),
      updated_at: `${todayStr} 08:00:00`,
      saved_by: 'seed',
    });
  }
  await put('map_landmarks/demo_hyd_101', {
    label: 'Hydrant #101 — Marina Blvd & 1st St',
    kind: 'hydrant',
    lat: 34.048,
    lng: -78.142,
    flow_gpm: 1650,
    note: 'Class AA (Blue Bonnet) — 12" main, 65 PSI static',
    created_at: `${todayStr} 08:00:00`,
    created_by: 'seed',
    updated_at: `${todayStr} 08:00:00`,
    updated_by: 'seed',
  });
  await put('map_landmarks/demo_hyd_102', {
    label: 'Hydrant #102 — Harborview Elementary Entrance',
    kind: 'hydrant',
    lat: 34.062,
    lng: -78.155,
    flow_gpm: 1200,
    note: 'Class A (Green Bonnet) — Clear 15ft access',
    created_at: `${todayStr} 08:00:00`,
    created_by: 'seed',
    updated_at: `${todayStr} 08:00:00`,
    updated_by: 'seed',
  });

  console.log('\n================================================================================');
  console.log('✔ Harborview Fire & Rescue (Demo Department) seeded!');
  console.log('================================================================================');
  console.log('Demo Accounts (Password for all accounts: ' + DEMO_LOGIN_PASSWORD + '):');
  console.log('  • admin       — Chief Alex Carter (Fire Chief / Full Administrator)');
  console.log('  • jchen       — Capt. Jordan Chen (Company Officer — Currently On Duty)');
  console.log('  • mrodriguez  — Lt. Maya Rodriguez (Training & Company Officer)');
  console.log('  • tbrooks     — Eng. Tyler Brooks (Engineer — Currently On Duty)');
  console.log('  • kpatel      — FF Kiran Patel (Firefighter / EMT — Currently On Duty)');
  console.log('================================================================================\n');
};

if (process.argv[1] && process.argv[1].endsWith('seed-demo-department.mjs')) {
  seedDemoDepartment().catch((err) => {
    console.error('\n✖ Demo seed failed:', err.message);
    process.exit(1);
  });
}

