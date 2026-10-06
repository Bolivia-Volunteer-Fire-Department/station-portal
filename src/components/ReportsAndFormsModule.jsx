import React, { useState } from 'react';
import { BarChart3, FileText } from 'lucide-react';

// REPORTS AND FORMS ARE ONE DESTINATION.
//
// They are two jobs - run a report, generate a printable form - but they are configured in one place (Administration →
// Reports holds a configuration tab for each), they read the station's records the same way, and they answer the same
// question: "show me what we have recorded". Two sidebar entries for that made a member read the list twice and guess
// which one held what.
//
// THE TWO HALVES ARE GATED BY DIFFERENT PERMISSIONS, which is why this is a file of its own rather than one big screen.
// `can_view_reports` and `can_generate_forms` are granted separately, so a member may hold one, the other, or both.
// What is on screen is DERIVED from what they hold rather than remembered in state: a role edit that takes one away
// cannot leave a section showing that is no longer theirs, and a member who holds only one never meets a switcher
// offering a section they cannot open.
//
// THE SCREENS ARRIVE AS ELEMENTS, NOT IMPORTS, and that is the one subtle thing here. Importing them would put both in
// this file's chunk, so a member who only holds `can_generate_forms` would download the Reports half too - and the
// Reports half carries recharts, which is most of it. Handing in `<ReportsModule />` and `<FormsModule />` as elements
// costs nothing (an unrendered element is a description, not a fetch) and React only fetches the chunk it renders, so
// the two halves stay the separate, permission-gated downloads they were before the merge.
const SECTIONS = [
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'forms', label: 'Forms', icon: FileText },
];

export default function ReportsAndFormsModule({
  canViewReports = false,
  canGenerateForms = false,
  reportsScreen = null,
  formsScreen = null,
}) {
  const holds = { reports: canViewReports, forms: canGenerateForms };
  const available = SECTIONS.filter((entry) => holds[entry.id]);
  const [picked, setPicked] = useState('');
  const active = available.some((entry) => entry.id === picked) ? picked : (available[0] && available[0].id) || '';
  const screen = active === 'reports' ? reportsScreen : formsScreen;

  // The App gate is `can_view_reports || can_generate_forms`, so there is always one section to show. Rendering nothing
  // rather than a switcher with no options is what keeps that honest if the two ever disagree.
  if (available.length === 0) return null;

  // One permission, so one screen and no switcher: a control with a single option is furniture, and the member without
  // the other permission would read it only to learn there is nothing behind it.
  if (available.length === 1) return screen;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Reports and forms" className="flex flex-wrap gap-1">
        {available.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.id === active;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setPicked(entry.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                selected
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </div>

      {screen}
    </div>
  );
}
