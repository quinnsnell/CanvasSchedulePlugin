/**
 * SelectionContext — bulk-select state for ItemCards.
 *
 * Threading selection props through ScheduleTable → ClassDayRow → ItemCard
 * (and a parallel chain through UnscheduledZone) is awkward, and the
 * selection state truly is "ambient" — every card needs to know whether
 * it's selected, but only App.jsx owns the set. A small context fits
 * better than wide prop drilling.
 */

import React, { createContext, useContext } from 'react';

const SelectionContext = createContext({
  selectedIds: new Set(),
  toggle: () => {},
  isSelectable: false,
});

export function SelectionProvider({ value, children }) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  return useContext(SelectionContext);
}
