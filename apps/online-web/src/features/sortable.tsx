import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A vertical list reordered by drag and drop (pointer, touch with a short press, keyboard),
 * the same way the link editor does it (ADR-0116 amendment 3). `onOrder` receives the new
 * order of ids; the server re-checks it.
 */
export function SortableList({
  ids,
  onOrder,
  children,
}: {
  ids: string[];
  onOrder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: t('sortable.instructions') } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

/** One row of a `SortableList`: a drag handle, up / down buttons for screen readers, content. */
export function SortableRow({
  id,
  label,
  first,
  last,
  onMove,
  children,
}: {
  id: string;
  label: string;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface p-2 ${
        isDragging ? 'z-20 shadow-lg ring-2 ring-primary' : ''
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('sortable.handle', { name: label })}
        className="grid h-10 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg active:cursor-grabbing"
      >
        <svg viewBox="0 0 12 20" width="12" height="20" fill="currentColor" aria-hidden>
          {[3, 10, 17].map((y) => (
            <g key={y}>
              <circle cx="3" cy={y} r="1.6" />
              <circle cx="9" cy={y} r="1.6" />
            </g>
          ))}
        </svg>
      </button>
      {children}
      <span className="flex shrink-0 flex-col">
        <button
          type="button"
          className="text-xs text-fg-muted hover:text-fg disabled:opacity-30"
          disabled={first}
          aria-label={t('sortable.moveUp', { name: label })}
          onClick={() => onMove(-1)}
        >
          ▲
        </button>
        <button
          type="button"
          className="text-xs text-fg-muted hover:text-fg disabled:opacity-30"
          disabled={last}
          aria-label={t('sortable.moveDown', { name: label })}
          onClick={() => onMove(1)}
        >
          ▼
        </button>
      </span>
    </li>
  );
}
