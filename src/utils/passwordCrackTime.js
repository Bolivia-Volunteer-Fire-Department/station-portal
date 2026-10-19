// Brute-force password crack time estimator based on the 2026 Hive Systems benchmark
// Hardware: 16 x RTX 5090 GPUs | Password Hash: bcrypt (cost factor 10)

export const BRUTE_FORCE_TABLE_2026 = {
  4: ['Instantly', 'Instantly', 'Instantly', 'Instantly', 'Instantly'],
  5: ['Instantly', 'Instantly', '46 mins', '2 hours', '3 hours'],
  6: ['Instantly', '37 mins', '2 days', '5 days', '1 week'],
  7: ['Instantly', '16 hours', '3 months', '10 months', '2 years'],
  8: ['Instantly', '2 weeks', '12 years', '50 years', '132 years'],
  9: ['2 hours', '1 year', '636 years', '3k years', '9k years'],
  10: ['20 hours', '32 years', '33k years', '191k years', '645k years'],
  11: ['1 week', '839 years', '1m years', '11m years', '45m years'],
  12: ['3 months', '21k years', '89m years', '737m years', '3bn years'],
  13: ['2 years', '567k years', '4bn years', '45bn years', '221bn years'],
  14: ['23 years', '14m years', '241bn years', '2tn years', '15tn years'],
  15: ['229 years', '383m years', '12tn years', '175tn years', '1qd years'],
  16: ['2k years', '9bn years', '653tn years', '10qd years', '75qd years'],
  17: ['22k years', '259bn years', '33qd years', '675qd years', '5qn years'],
  18: ['228k years', '6tn years', '1qn years', '41qn years', '372qn years'],
};

/**
 * Maps crack time string to a security tier 1-5 corresponding to heatmap colors.
 * Tier 1: Instantly (Purple)
 * Tier 2: Under 1 year - minutes to months (Red)
 * Tier 3: 1 to 50 years (Orange)
 * Tier 4: 100+ years up to 45m years (Yellow)
 * Tier 5: 45m+ years, billions to quintillions (Emerald Green)
 */
export function getCrackTimeTier(crackTime) {
  if (!crackTime || crackTime === 'Instantly') return 1;

  // Under 1 year (minutes, hours, days, weeks, months) -> Tier 2
  if (/(min|hour|day|week|month)/i.test(crackTime)) return 2;

  // Years under 50 -> Tier 3
  const yrMatch = crackTime.match(/^(\d+)\s*years?$/i);
  if (yrMatch) {
    const yrs = parseInt(yrMatch[1], 10);
    if (yrs <= 50) return 3;
    if (yrs < 1000) return 4;
  }

  // k years, m years under 45m -> Tier 4
  if (/k years/i.test(crackTime)) return 4;
  const mMatch = crackTime.match(/^(\d+)m\s*years?$/i);
  if (mMatch) {
    const mYrs = parseInt(mMatch[1], 10);
    if (mYrs < 45) return 4;
    return 5;
  }

  // 45m+, billions, trillions, quadrillions, quintillions -> Tier 5
  if (/(bn|tn|qd|qn)/i.test(crackTime) || />/i.test(crackTime)) return 5;

  return 3;
}

export const TIER_CONFIG = {
  1: {
    label: 'Very Weak',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    border: 'border-purple-200 dark:border-purple-800/60',
    segmentColor: 'bg-purple-500',
  },
  2: {
    label: 'Weak',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    border: 'border-rose-200 dark:border-rose-800/60',
    segmentColor: 'bg-rose-500',
  },
  3: {
    label: 'Moderate',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-800/60',
    segmentColor: 'bg-amber-500',
  },
  4: {
    label: 'Strong',
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-950/40',
    border: 'border-yellow-200 dark:border-yellow-800/60',
    segmentColor: 'bg-yellow-500',
  },
  5: {
    label: 'Very Strong',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200 dark:border-emerald-800/60',
    segmentColor: 'bg-emerald-500',
  },
};

/**
 * Computes estimated crack time and character composition breakdown for a given password.
 */
export function estimatePasswordCrackTime(password) {
  const pwd = String(password || '');
  const length = pwd.length;

  if (length === 0) {
    return {
      charCount: 0,
      crackTime: '',
      tier: 0,
      categoryLabel: '',
      hasNumbers: false,
      hasLower: false,
      hasUpper: false,
      hasSymbols: false,
      tierConfig: null,
    };
  }

  const hasNumbers = /[0-9]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasUpper = /[A-Z]/.test(pwd);
  const hasSymbols = /[^a-zA-Z0-9]/.test(pwd);

  const classesCount = (hasNumbers ? 1 : 0) + (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasSymbols ? 1 : 0);

  let columnIndex = 0;
  let categoryLabel = 'Numbers Only';

  if (classesCount === 1) {
    if (hasNumbers) {
      columnIndex = 0;
      categoryLabel = 'Numbers Only';
    } else if (hasLower) {
      columnIndex = 1;
      categoryLabel = 'Lowercase Letters';
    } else if (hasUpper) {
      columnIndex = 1;
      categoryLabel = 'Uppercase Letters';
    } else {
      columnIndex = 1;
      categoryLabel = 'Symbols Only';
    }
  } else if (classesCount === 2) {
    columnIndex = 2;
    if (hasLower && hasUpper) {
      categoryLabel = 'Upper & Lowercase Letters';
    } else if ((hasLower || hasUpper) && hasNumbers) {
      categoryLabel = 'Letters & Numbers';
    } else if ((hasLower || hasUpper) && hasSymbols) {
      categoryLabel = 'Letters & Symbols';
    } else {
      categoryLabel = 'Numbers & Symbols';
    }
  } else if (classesCount === 3) {
    columnIndex = 3;
    if (hasNumbers && hasLower && hasUpper) {
      categoryLabel = 'Numbers, Upper & Lowercase';
    } else if (hasSymbols && hasNumbers) {
      categoryLabel = 'Letters, Numbers & Symbols';
    } else {
      categoryLabel = 'Upper, Lower & Symbols';
    }
  } else {
    columnIndex = 4;
    categoryLabel = 'Numbers, Upper & Lowercase, Symbols';
  }

  let crackTime = 'Instantly';

  if (length < 4) {
    crackTime = 'Instantly';
  } else if (length <= 18) {
    crackTime = BRUTE_FORCE_TABLE_2026[length][columnIndex];
  } else {
    // Length > 18
    if (columnIndex === 0) {
      if (length === 19) crackTime = '2m years';
      else if (length === 20) crackTime = '22m years';
      else if (length === 21) crackTime = '228m years';
      else if (length === 22) crackTime = '2bn years';
      else if (length === 23) crackTime = '22bn years';
      else crackTime = '> 100bn years';
    } else if (columnIndex === 1) {
      if (length === 19) crackTime = '156tn years';
      else if (length === 20) crackTime = '4qd years';
      else crackTime = '> 100qd years';
    } else if (columnIndex === 2) {
      if (length === 19) crackTime = '52qn years';
      else crackTime = '> 1,000qn years';
    } else {
      crackTime = '> 1,000qn years';
    }
  }

  const tier = getCrackTimeTier(crackTime);
  const tierConfig = TIER_CONFIG[tier] || TIER_CONFIG[1];

  return {
    charCount: length,
    crackTime,
    tier,
    categoryLabel,
    hasNumbers,
    hasLower,
    hasUpper,
    hasSymbols,
    tierConfig,
  };
}

export const PASSWORD_MIN_STRENGTH_KEY = 'password_min_strength';

export const PASSWORD_STRENGTH_LEVELS = [
  {
    id: 'none',
    minTier: 0,
    label: 'None',
    description: 'No strength requirement enforced',
  },
  {
    id: 'very_weak',
    minTier: 1,
    label: 'Very Weak or better',
    description: 'Any non-empty password (Tier 1+)',
  },
  {
    id: 'weak',
    minTier: 2,
    label: 'Weak or better',
    description: 'Takes at least minutes/hours to crack (Tier 2+)',
  },
  {
    id: 'moderate',
    minTier: 3,
    label: 'Moderate or better',
    description: 'Takes at least 1 year to crack (Tier 3+)',
  },
  {
    id: 'strong',
    minTier: 4,
    label: 'Strong or better',
    description: 'Takes at least 100+ years to crack (Tier 4+)',
  },
  {
    id: 'very_strong',
    minTier: 5,
    label: 'Very Strong only',
    description: 'Takes 45M+ years to crack (Tier 5)',
  },
];

/**
 * Reads the configured minimum password strength policy from system settings.
 */
export function getRequiredPasswordStrength(systemSettings) {
  let raw = '';
  if (Array.isArray(systemSettings)) {
    const row = systemSettings.find((r) => String(r?.key ?? '').trim() === PASSWORD_MIN_STRENGTH_KEY);
    raw = row?.value ?? '';
  } else if (systemSettings && typeof systemSettings === 'object') {
    raw = systemSettings[PASSWORD_MIN_STRENGTH_KEY] ?? '';
  }
  raw = String(raw).trim().toLowerCase();
  return PASSWORD_STRENGTH_LEVELS.find((lvl) => lvl.id === raw) || PASSWORD_STRENGTH_LEVELS[0];
}

/**
 * Validates a password against the configured station strength policy.
 */
export function checkPasswordStrengthPolicy(password, systemSettings) {
  const policy = getRequiredPasswordStrength(systemSettings);
  if (!policy || policy.minTier === 0) {
    return { ok: true, problem: '', currentTier: 0, requiredTier: 0, policy };
  }

  const pwd = String(password || '');
  if (!pwd) {
    return {
      ok: false,
      problem: 'Please enter a password.',
      currentTier: 0,
      requiredTier: policy.minTier,
      policy,
    };
  }

  const estimate = estimatePasswordCrackTime(pwd);
  if (estimate.tier < policy.minTier) {
    return {
      ok: false,
      problem: `Password does not meet the station security policy. It must be ${policy.label} (currently: ${estimate.tierConfig?.label || 'Very Weak'}, estimated crack time: ${estimate.crackTime}).`,
      currentTier: estimate.tier,
      requiredTier: policy.minTier,
      policy,
    };
  }

  return {
    ok: true,
    problem: '',
    currentTier: estimate.tier,
    requiredTier: policy.minTier,
    policy,
  };
}

