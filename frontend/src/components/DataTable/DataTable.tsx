import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type PointerSensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Header,
  type RowData,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { getTablePrefs, saveTablePrefs } from "@/lib/table-prefs-db";
import "./column-meta";
import styles from "./DataTable.module.css";

const COMPACT_QUERY = "(max-width: 900px)";
const MIN_COLUMN_WIDTH = 80;
const EMPTY_SORTING: SortingState = [];

type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;

export type DataTableProps<T> = {
  tableKey: string;
  data: T[];
  columns: ColumnDef<T, any>[];
  className?: string;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  rowStyle?: (row: T) => CSSProperties | undefined;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Rendered before sorted rows. Stays put when the body is sorted. */
  topRow?: (table: Table<T>) => ReactNode;
  /** Replaces the default body rows. Headers, widths, and visibility still apply. */
  renderBody?: (table: Table<T>) => ReactNode;
  /** Totals row that does not take part in sorting. */
  footer?: ReactNode;
  enableSorting?: boolean;
};

function columnHeaderLabel(column: { id: string; columnDef: { header?: unknown; meta?: unknown } }): string {
  const meta = column.columnDef.meta as { label?: string } | undefined;
  if (meta?.label) return meta.label;
  return typeof column.columnDef.header === "string" ? column.columnDef.header : column.id;
}

function sortButtonLabel(name: string, sorted: false | "asc" | "desc", t: Translate): string {
  if (sorted === "asc") return t("table.sort.asc", "{{name}}: ascending", { name });
  if (sorted === "desc") return t("table.sort.desc", "{{name}}: descending", { name });
  return t("table.sort.none", "{{name}}: not sorted", { name });
}

function useCompactTable(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

class HeaderPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (
        { nativeEvent: event }: ReactPointerEvent,
        { onActivation }: PointerSensorOptions,
      ) => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (event.target instanceof Element && event.target.closest("[data-no-dnd]")) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

function SortableHeader<T extends RowData>({
  header,
  compact,
  onResizeStart,
}: {
  header: Header<T, unknown>;
  compact: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
  });
  const meta = header.column.columnDef.meta;
  const canSort = header.column.getCanSort();
  const sorted = header.column.getIsSorted();
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const label = flexRender(header.column.columnDef.header, header.getContext());
  const indicator = sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : null;

  return (
    <th
      ref={setNodeRef}
      colSpan={header.colSpan}
      style={style}
      className={clsx(
        meta?.align === "right" && styles.alignRight,
        meta?.headerClassName,
        isDragging && styles.dragging,
      )}
    >
      <div className={styles.headerCell}>
        <div className={styles.dragHandle} {...attributes} {...listeners}>
          {canSort ? (
            <button
              type="button"
              className={styles.sortBtn}
              onClick={header.column.getToggleSortingHandler()}
            >
              {label}
              {indicator}
            </button>
          ) : (
            <span className={styles.sortBtn}>{label}</span>
          )}
        </div>
        <span
          className={styles.resizer}
          data-no-dnd
          aria-hidden="true"
          onPointerDown={onResizeStart}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </th>
  );
}

export function DataTable<T>({
  tableKey,
  data,
  columns,
  className,
  getRowId,
  onRowClick,
  rowClassName,
  rowStyle,
  isLoading = false,
  emptyMessage,
  topRow,
  renderBody,
  footer,
  enableSorting = true,
}: DataTableProps<T>) {
  const { t } = useLanguage();
  const compact = useCompactTable();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [stateKey, setStateKey] = useState(tableKey);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  if (stateKey !== tableKey) {
    setStateKey(tableKey);
    setLoadedKey(null);
    setSorting([]);
    setColumnVisibility({});
    setColumnSizing({});
    setColumnOrder([]);
    setColumnsMenuOpen(false);
  }

  const prefsLoaded = loadedKey === tableKey;
  const sensors = useSensors(useSensor(HeaderPointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    let cancelled = false;
    void getTablePrefs(tableKey)
      .then((prefs) => {
        if (cancelled) return;
        setSorting(prefs?.sorting ?? []);
        setColumnVisibility(prefs?.columnVisibility ?? {});
        setColumnSizing(prefs?.columnSizing ?? {});
        setColumnOrder(prefs?.columnOrder ?? []);
        setLoadedKey(tableKey);
      })
      .catch(() => {
        if (!cancelled) setLoadedKey(tableKey);
      });
    return () => {
      cancelled = true;
    };
  }, [tableKey]);

  useEffect(() => {
    if (!prefsLoaded) return;
    void saveTablePrefs(tableKey, {
      sorting,
      columnVisibility,
      columnSizing,
      columnOrder,
    }).catch(() => {
      // The table still works when IndexedDB is unavailable.
    });
  }, [columnOrder, columnSizing, columnVisibility, prefsLoaded, sorting, tableKey]);

  const table = useReactTable({
    data,
    columns,
    // Use a stable empty sorting reference when sorting is disabled.
    // A fresh `[]` each render makes TanStack treat controlled state as changed
    // and can re-enter setState → render → setState (max update depth).
    state: {
      sorting: enableSorting ? sorting : EMPTY_SORTING,
      columnVisibility,
      columnSizing,
      columnOrder,
    },
    onSortingChange: (updater) => {
      if (!enableSorting) return;
      setSorting(updater);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    enableSorting,
    enableMultiSort: false,
    sortDescFirst: false,
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    defaultColumn: {
      size: 160,
      minSize: MIN_COLUMN_WIDTH,
    },
  });

  const tableRef = useRef(table);
  tableRef.current = table;

  const placeMenu = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 240;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const maxHeight = Math.min(420, Math.round(window.innerHeight * 0.6));
    let top = rect.bottom + 6;
    if (top + maxHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - 6 - maxHeight);
    }
    setMenuBox({ top, left, maxHeight });
  }, []);

  useEffect(() => {
    if (!columnsMenuOpen) return;
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [columnsMenuOpen, placeMenu]);

  useEffect(() => {
    if (!columnsMenuOpen) return;
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setColumnsMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [columnsMenuOpen]);

  const hideableVisibleCount = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.getIsVisible()).length;

  function canToggleVisibility(column: Column<T, unknown>): boolean {
    if (!column.getCanHide()) return false;
    if (!column.getIsVisible()) return true;
    return hideableVisibleCount > 1;
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = tableRef.current.getAllLeafColumns().map((column) => column.id);
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setColumnOrder(arrayMove(order, oldIndex, newIndex));
  }, []);

  function startResize(columnId: string, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = table.getColumn(columnId)?.getSize() ?? 120;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("regos-column-resizing");

    function onMove(moveEvent: PointerEvent) {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX);
      setColumnSizing((prev) => ({ ...prev, [columnId]: next }));
    }

    function onUp() {
      document.body.classList.remove("regos-column-resizing");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  const visibleLeaves = table.getVisibleLeafColumns();
  const visibleLeafIds = visibleLeaves.map((column) => column.id);
  const totalSize = Math.max(table.getTotalSize(), 1);
  const headerGroups = table.getHeaderGroups();
  const visibleCount = Math.max(visibleLeafIds.length, 1);
  const rows = table.getRowModel().rows;
  const showEmpty = !renderBody && (isLoading || rows.length === 0);

  const menu =
    columnsMenuOpen && menuBox
      ? createPortal(
          <div
            ref={panelRef}
            className={styles.menu}
            role="menu"
            style={{ top: menuBox.top, left: menuBox.left, maxHeight: menuBox.maxHeight }}
            data-no-dnd
          >
            {table.getAllLeafColumns().map((column) => {
              const label = columnHeaderLabel(column);
              const sorted = column.getIsSorted();
              const checkbox = (
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  disabled={!canToggleVisibility(column)}
                  onChange={() => {
                    if (!canToggleVisibility(column)) return;
                    column.toggleVisibility();
                  }}
                />
              );
              if (!column.getCanSort()) {
                return (
                  <label key={column.id} className={styles.menuItem}>
                    {checkbox}
                    <span className={styles.menuLabel}>{label}</span>
                  </label>
                );
              }
              return (
                <div key={column.id} className={clsx(styles.menuItem, styles.menuItemSort)}>
                  <label className={styles.menuCheck}>
                    {checkbox}
                    <span className={styles.menuLabel}>{label}</span>
                  </label>
                  <button
                    type="button"
                    className={clsx(styles.menuSort, sorted && styles.menuSortActive)}
                    aria-label={sortButtonLabel(label, sorted, t)}
                    title={sortButtonLabel(label, sorted, t)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      column.toggleSorting(undefined, false);
                    }}
                  >
                    {sorted === "asc" ? (
                      <ArrowUp size={14} aria-hidden="true" />
                    ) : sorted === "desc" ? (
                      <ArrowDown size={14} aria-hidden="true" />
                    ) : (
                      <ArrowUpDown size={14} aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={styles.root}>
      <div className={styles.menuAnchor} ref={anchorRef} data-no-dnd>
        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setColumnsMenuOpen((open) => !open)}
          aria-expanded={columnsMenuOpen}
          aria-haspopup="true"
          aria-label={t("table.columns", "Column settings")}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
        </button>
      </div>
      {menu}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <table
          className={clsx(styles.table, className)}
          style={compact ? undefined : { width: "100%", tableLayout: "fixed" }}
        >
          {compact ? null : (
            <colgroup>
              {visibleLeaves.map((column) => (
                <col key={column.id} style={{ width: `${(column.getSize() / totalSize) * 100}%` }} />
              ))}
            </colgroup>
          )}
          <thead>
            {headerGroups.map((headerGroup, groupIndex) => {
              const leafRow = groupIndex === headerGroups.length - 1;
              const cells = headerGroup.headers.map((header) => {
                if (leafRow && !header.isPlaceholder && header.subHeaders.length === 0) {
                  return (
                    <SortableHeader
                      key={header.id}
                      header={header}
                      compact={compact}
                      onResizeStart={(event) => startResize(header.column.id, event)}
                    />
                  );
                }
                if (header.isPlaceholder) {
                  return <th key={header.id} colSpan={header.colSpan} rowSpan={header.rowSpan} />;
                }
                const meta = header.column.columnDef.meta;
                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    rowSpan={header.rowSpan}
                    className={clsx(meta?.align === "right" && styles.alignRight, meta?.headerClassName)}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              });
              if (!leafRow) {
                return <tr key={headerGroup.id}>{cells}</tr>;
              }
              return (
                <SortableContext
                  key={headerGroup.id}
                  items={visibleLeafIds}
                  strategy={horizontalListSortingStrategy}
                >
                  <tr>{cells}</tr>
                </SortableContext>
              );
            })}
          </thead>
          <tbody>
            {topRow ? topRow(table) : null}
            {renderBody ? (
              renderBody(table)
            ) : showEmpty ? (
              <tr>
                <td colSpan={visibleCount} className={styles.emptyCell}>
                  {isLoading ? t("common.loading") : (emptyMessage ?? t("common.nothing", "Nothing found"))}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={clsx(onRowClick && styles.clickable, rowClassName?.(row.original))}
                  style={rowStyle?.(row.original)}
                  onClick={
                    onRowClick
                      ? (event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest("button, a, input, select, textarea, label")) return;
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <td
                        key={cell.id}
                        className={clsx(meta?.align === "right" && styles.alignRight, meta?.cellClassName)}
                        data-label={columnHeaderLabel(cell.column)}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
        <DragOverlay>
          {activeDragId ? (
            <div className={styles.dragOverlay}>
              {columnHeaderLabel(table.getColumn(activeDragId) ?? { id: activeDragId, columnDef: {} })}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export { columnHeaderLabel };
