// Equipment, asset tracking, and NFPA/DOT lifecycle calculation utilities.

export const EQUIPMENT_CATEGORIES = [
  { id: 'turnout_gear', label: 'Turnout Gear', description: 'NFPA 1851 10-year retirement & annual inspections' },
  { id: 'radios', label: 'Radios', description: 'Portable & mobile radio assignments by serial number' },
  { id: 'scba_cylinders', label: 'SCBA Bottles', description: '5-year hydro requalification & 15-year service life' },
];

export const TURNOUT_GEAR_TYPES = [
  { id: 'coat', label: 'Bunker Coat' },
  { id: 'pant', label: 'Bunker Pant' },
  { id: 'helmet', label: 'Helmet' },
  { id: 'boots', label: 'Boots' },
  { id: 'gloves', label: 'Gloves' },
  { id: 'hood', label: 'Nomex Head Scarf / Hood' },
];

export const RADIO_TYPES = [
  { id: 'portable', label: 'Portable Radio (Handheld)' },
  { id: 'mobile', label: 'Mobile Radio (Vehicle Rig)' },
  { id: 'pager', label: 'Pager / Minitor' },
  { id: 'base', label: 'Base Station' },
];

export const EQUIPMENT_CONDITIONS = [
  { id: 'in_service', label: 'In Service', color: 'emerald' },
  { id: 'spare', label: 'Spare / Pool', color: 'blue' },
  { id: 'needs_inspection', label: 'Inspection Due', color: 'amber' },
  { id: 'needs_hydro', label: 'Hydro Test Due', color: 'amber' },
  { id: 'needs_repair', label: 'Needs Repair', color: 'orange' },
  { id: 'out_of_service', label: 'Out of Service', color: 'rose' },
  { id: 'retired', label: 'Retired', color: 'slate' },
];

// Helper to add years to a date string YYYY-MM-DD.
export const addYearsToDate = (dateStr, years) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString().slice(0, 10);
};

// Helper to add months to a date string YYYY-MM-DD.
export const addMonthsToDate = (dateStr, months) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
};

// Calculates days remaining between today and a target YYYY-MM-DD date.
export const daysDifferenceFromToday = (targetDateStr) => {
  if (!targetDateStr) return null;
  const target = new Date(targetDateStr);
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

// NFPA 1851: Turnout gear must be retired within 10 years from the date of manufacture.
export const evaluateTurnoutRetirement = (manufactureDate) => {
  if (!manufactureDate) {
    return { retirementDate: '', isExpired: false, daysRemaining: null, label: 'Unknown MFG Date', badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
  const retirementDate = addYearsToDate(manufactureDate, 10);
  const days = daysDifferenceFromToday(retirementDate);
  if (days === null) {
    return { retirementDate: '', isExpired: false, daysRemaining: null, label: 'Unknown MFG Date', badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
  if (days < 0) {
    const expiredYears = (Math.abs(days) / 365.25).toFixed(1);
    return {
      retirementDate,
      isExpired: true,
      daysRemaining: days,
      label: `Expired (${expiredYears}y ago - NFPA 10yr)`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    };
  }
  if (days <= 180) {
    return {
      retirementDate,
      isExpired: false,
      daysRemaining: days,
      label: `Retires in ${days} days`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    };
  }
  const yearsLeft = (days / 365.25).toFixed(1);
  return {
    retirementDate,
    isExpired: false,
    daysRemaining: days,
    label: `${yearsLeft} yrs remaining`,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  };
};

// NFPA 1851: Annual routine / advanced inspection cycle (12 months from last inspection).
export const evaluateInspectionCycle = (lastInspectionDate) => {
  if (!lastInspectionDate) {
    return { nextDue: '', isOverdue: true, daysRemaining: null, label: 'No Inspection on Record', badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' };
  }
  const nextDue = addMonthsToDate(lastInspectionDate, 12);
  const days = daysDifferenceFromToday(nextDue);
  if (days === null) {
    return { nextDue: '', isOverdue: false, daysRemaining: null, label: 'Invalid Date', badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
  if (days < 0) {
    return {
      nextDue,
      isOverdue: true,
      daysRemaining: days,
      label: `Inspection Overdue (${Math.abs(days)}d)`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    };
  }
  if (days <= 60) {
    return {
      nextDue,
      isOverdue: false,
      daysRemaining: days,
      label: `Inspection due in ${days}d`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    };
  }
  return {
    nextDue,
    isOverdue: false,
    daysRemaining: days,
    label: `Inspected (due ${nextDue})`,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  };
};

// SCBA Composite Cylinders:
// 1. Hydrostatic test every 5 years.
// 2. Maximum service lifetime 15 years from manufacture date.
export const evaluateScbaLifecycles = (lastHydroDate, manufactureDate) => {
  const hydroNextDue = lastHydroDate ? addYearsToDate(lastHydroDate, 5) : '';
  const retirementDate = manufactureDate ? addYearsToDate(manufactureDate, 15) : '';

  const hydroDays = daysDifferenceFromToday(hydroNextDue);
  const lifeDays = daysDifferenceFromToday(retirementDate);

  const isLifeExpired = lifeDays !== null && lifeDays < 0;
  const isHydroOverdue = hydroDays !== null && hydroDays < 0;

  let hydroStatus = {
    dueDate: hydroNextDue,
    isOverdue: isHydroOverdue,
    label: 'Hydro OK',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  };

  if (!lastHydroDate) {
    hydroStatus = {
      dueDate: '',
      isOverdue: true,
      label: 'Hydro Date Missing',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300',
    };
  } else if (isHydroOverdue) {
    hydroStatus = {
      dueDate: hydroNextDue,
      isOverdue: true,
      label: `Hydro Overdue (${Math.abs(hydroDays)}d)`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    };
  } else if (hydroDays <= 90) {
    hydroStatus = {
      dueDate: hydroNextDue,
      isOverdue: false,
      label: `Hydro Due in ${hydroDays}d`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    };
  } else {
    hydroStatus = {
      dueDate: hydroNextDue,
      isOverdue: false,
      label: `Hydro Due ${hydroNextDue}`,
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    };
  }

  let lifeStatus = {
    retirementDate,
    isExpired: isLifeExpired,
    label: '15yr Life OK',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  };

  if (!manufactureDate) {
    lifeStatus = {
      retirementDate: '',
      isExpired: false,
      label: 'Unknown MFG Date',
      badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    };
  } else if (isLifeExpired) {
    lifeStatus = {
      retirementDate,
      isExpired: true,
      label: `15-Year Life Expired (${retirementDate})`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    };
  } else if (lifeDays <= 180) {
    lifeStatus = {
      retirementDate,
      isExpired: false,
      label: `15-Year Life ends in ${lifeDays}d`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    };
  } else {
    const yearsLeft = (lifeDays / 365.25).toFixed(1);
    lifeStatus = {
      retirementDate,
      isExpired: false,
      label: `${yearsLeft} yrs bottle life remaining`,
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    };
  }

  return { hydroStatus, lifeStatus };
};

// Formats condition tag into a badge styling.
export const conditionBadgeStyle = (conditionId) => {
  const match = EQUIPMENT_CONDITIONS.find((c) => c.id === conditionId);
  const color = match?.color || 'slate';
  switch (color) {
    case 'emerald':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    case 'blue':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
    case 'amber':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
    case 'orange':
      return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800';
    case 'rose':
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800';
    case 'slate':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
};

