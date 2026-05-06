/**
 * UnscheduledZone — sidebar drop target for items without a scheduled date.
 * Items dragged here are removed from the calendar. Canvas assignments
 * imported without a due_at also land here.
 *
 * Uses @dnd-kit/core useDroppable + @dnd-kit/sortable SortableContext
 * for touch-friendly drag-and-drop.
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { T } from '../theme.js';
import ItemCard from './ItemCard.jsx';

export default function UnscheduledZone({
  items, canvas, assignmentGroups, onMoveItem, onUpdateItem, onDeleteItem,
  draggingId, autoEditId, clearAutoEdit,
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'unscheduled',
    data: { type: 'unscheduled' },
  });

  const itemIds = items.map((item) => item.id);

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? T.inkBlueSoft : T.subtle,
        border: `1px dashed ${T.borderStrong}`,
        borderRadius: 4, padding: 12, minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 8,
        transition: 'background 120ms',
      }}
    >
      {items.length === 0 && (
        <div style={{ color: T.muted, fontSize: '12px', textAlign: 'center', padding: '20px 8px', fontStyle: 'italic' }}>
          Drag items here to remove from the schedule.
          Imported assignments without a due date land here too.
        </div>
      )}
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <ItemCard
            key={item.id} item={item} isStudent={false} canvas={canvas}
            onUpdate={onUpdateItem} onDelete={onDeleteItem}
            draggingId={draggingId}
            autoEdit={autoEditId === item.id}
            onAutoEditConsumed={clearAutoEdit}
            assignmentGroups={assignmentGroups}
          />
        ))}
      </SortableContext>
    </div>
  );
}
