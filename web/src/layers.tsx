/**
 * The layers panel.
 *
 *   §23  The panel is the scene's order, shown the way a reader expects it:
 *        topmost first, because that is what "on top" means on screen. The
 *        document stores the stack bottom-to-top, so the two are reverses of
 *        each other and the conversion happens at this boundary, once.
 *   §24  A drag shows where the layer will land before it lands, as a line
 *        between two rows rather than a highlight on one - "between B and C"
 *        is the thing being chosen, and highlighting a row says "into C".
 *
 * Dragging is not the only way to reorder. WCAG 2.2 asks every drag to have a
 * single-pointer or keyboard alternative, so Alt with the arrow keys moves the
 * focused layer, and that path goes through exactly the same callback.
 */
import { memo, useRef, useState } from "react";
import { FileImage, Frame, GripVertical } from "lucide-react";
import type { Asset } from "@/src/flow";

/** One row, already in the order the panel shows: topmost first. */
export type LayerRow = {
  key: string; name: string; frame: boolean; empty: boolean; asset?: Asset;
  /** Fixed at the base of the stack and not draggable - see `subjectKey`. */
  pinned?: boolean;
};

/**
 * Memoised: the panel describes which objects exist, not where they are, so
 * dragging one across the canvas has nothing to tell it. Without this it
 * re-rendered its whole list of thumbnails on every frame of every drag, for
 * a picture that never changed.
 */
export const LayersPanel = memo(function LayersPanel({ rows, selection, onSelect, onReorder }: {
  rows: LayerRow[];
  selection: string[];
  onSelect: (key: string, additive: boolean) => void;
  /** `to` is a slot in this panel's own order: 0 is above the first row. */
  onReorder: (key: string, to: number) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const dragging = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  /** Which gap the pointer is nearest, by the midpoint of each row. */
  const slotAt = (clientY: number) => {
    const items = Array.from(list.current?.children ?? []) as HTMLElement[];
    for (let index = 0; index < items.length; index += 1) {
      const box = items[index].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) return index;
    }
    return items.length;
  };

  const finish = (key: string, event: React.PointerEvent) => {
    const slot = dropAt;
    dragging.current = null;
    setDropAt(null);
    // No gap was ever chosen, so the pointer never really moved: this was a
    // click, and a click selects.
    if (slot === null) { onSelect(key, event.shiftKey || event.ctrlKey || event.metaKey); return; }
    onReorder(key, slot);
  };

  if (!rows.length) return <p className="layers-empty">Nothing on the canvas yet.</p>;

  return <ul className="layers-list" ref={list} role="listbox" aria-label="Layers" aria-multiselectable="true">
    {rows.map((row, index) => <li key={row.key}
      className={`${dropAt === index ? "drop-above" : ""} ${dropAt === rows.length && index === rows.length - 1 ? "drop-below" : ""}`}>
      <button type="button" role="option" aria-selected={selection.includes(row.key)}
        className={`layer-row ${selection.includes(row.key) ? "active" : ""} ${dragging.current === row.key ? "lifted" : ""} ${row.pinned ? "pinned" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || row.pinned) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = row.key;
        }}
        onPointerMove={(event) => { if (dragging.current === row.key) setDropAt(slotAt(event.clientY)); }}
        onPointerUp={(event) => { if (dragging.current === row.key) finish(row.key, event); }}
        onPointerCancel={() => { dragging.current = null; setDropAt(null); }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault(); onSelect(row.key, event.shiftKey || event.ctrlKey || event.metaKey); return;
          }
          // The keyboard alternative to dragging. Alt is the modifier because
          // the bare arrows already move the selected object on the canvas.
          if (!event.altKey || row.pinned) return;
          // Slots are counted before the row is lifted out, so moving down by
          // one row means skipping over the row below it as well as itself.
          if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); onReorder(row.key, index - 1); }
          if (event.key === "ArrowDown" && index < rows.length - 1) { event.preventDefault(); onReorder(row.key, index + 2); }
        }}>
        {row.pinned ? <span className="layer-grip" aria-hidden="true" /> : <GripVertical className="layer-grip" aria-hidden="true" />}
        <span className="layer-thumb" aria-hidden="true">
          {row.asset?.thumbnailUrl || row.asset?.url
            ? <img src={row.asset.thumbnailUrl ?? row.asset.url} alt="" draggable={false} />
            : row.frame ? <Frame /> : <FileImage />}
        </span>
        <span className="layer-name">{row.name}</span>
        {row.frame && <span className="layer-kind">{row.empty ? "Empty frame" : "Frame"}</span>}
        {row.pinned && <span className="layer-kind" title="The page's own image. It always draws underneath.">Page image</span>}
      </button>
    </li>)}
  </ul>;
});
