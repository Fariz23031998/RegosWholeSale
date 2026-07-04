import { softJsonWarning, tryFormatJson } from "@/lib/request";

type Props = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

export function BodyEditor({ value, onChange, rows = 14 }: Props) {
  const warning = softJsonWarning(value);

  function formatJson() {
    const formatted = tryFormatJson(value);
    if (formatted != null) onChange(formatted);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">Body</label>
        <div className="flex items-center gap-2">
          {warning && (
            <span className="text-xs text-amber-700" title={warning}>
              JSON parse warning (send is not blocked)
            </span>
          )}
          <button
            type="button"
            onClick={formatJson}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Format JSON
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        placeholder="{}"
        className="mono w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed"
      />
    </div>
  );
}
