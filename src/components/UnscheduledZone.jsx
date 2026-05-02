/**
 * UnscheduledZone — sidebar drop target for items without a scheduled date.
 * Items dragged here are removed from the calendar. Canvas assignments
 * imported without a due_at also land here.
 */

import React, { useState } from 'react';
import { T } from '../theme.js';
import ItemCard from './ItemCard.jsx';

export default function UnscheduledZone({
  items, canvas, onMoveItem, onUpdateItem, onDeleteItem,
  draggingId, setDraggingId, autoEditId, clearAutoEdit,
}) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHovering(true); }}
      onDragLeave={() => setHovering(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHovering(false);
        setDraggingId(null);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onMoveItem(id, null);
      }}
      style={{
        background: hovering ? T.inkBlueSoft : T.subtle,
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
      {items.map((item) => (
        <ItemCard
          key={item.id} item={item} isStudent={false} canvas={canvas}
          onUpdate={onUpdateItem} onDelete={onDeleteItem}
          draggingId={draggingId} setDraggingId={setDraggingId}
          autoEdit={autoEditId === item.id}
          onAutoEditConsumed={clearAutoEdit}
        />
      ))}
    </div>
  );
}
