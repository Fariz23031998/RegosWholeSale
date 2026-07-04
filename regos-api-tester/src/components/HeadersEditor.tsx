import type { HeaderPair } from "@/lib/request";

type Props = {
  headers: HeaderPair[];
  onChange: (headers: HeaderPair[]) => void;
};

export function HeadersEditor({ headers, onChange }: Props) {
  function update(id: string, field: "key" | "value", value: string) {
    onChange(headers.map((h) => (h.id === id ? { ...h, [field]: value } : h)));
  }

  function remove(id: string) {
    onChange(headers.filter((h) => h.id !== id));
  }

  function add() {
    onChange([...headers, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">Headers</label>
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          Add header
        </button>
      </div>
      <div className="space-y-2">
        {headers.map((header) => (
          <div key={header.id} className="flex gap-2">
            <input
              value={header.key}
              onChange={(e) => update(header.id, "key", e.target.value)}
              placeholder="Header name"
              className="mono min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
            <input
              value={header.value}
              onChange={(e) => update(header.id, "value", e.target.value)}
              placeholder="Value"
              className="mono min-w-0 flex-[1.5] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => remove(header.id)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-red-50 hover:text-red-700"
              title="Remove header"
            >
              ×
            </button>
          </div>
        ))}
        {headers.length === 0 && (
          <p className="text-xs text-slate-500">No headers. Add any headers you need.</p>
        )}
      </div>
    </div>
  );
}
