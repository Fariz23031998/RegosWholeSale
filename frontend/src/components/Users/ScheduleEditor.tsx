import { Trash2 } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { normalizeScheduleTime } from "@/lib/schedule-time";
import { DAY_LABELS, type ScheduleItem } from "@/types/users";
import styles from "./Users.module.css";

type Props = {
  schedules: ScheduleItem[];
  onChange: (schedules: ScheduleItem[]) => void;
  disabled?: boolean;
};

function defaultRow(): ScheduleItem {
  return { day_of_week: 0, start_time: "09:00", end_time: "17:00" };
}

export function ScheduleEditor({ schedules, onChange, disabled }: Props) {
  const addRow = () => {
    onChange([...schedules, defaultRow()]);
  };

  const updateRow = (index: number, patch: Partial<ScheduleItem>) => {
    onChange(schedules.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(schedules.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.field}>
      <div className={styles.sectionTitle}>Login schedules</div>
      <p className={styles.hint}>
        No schedules = login allowed anytime. Times use 24-hour format (HH:MM, e.g. 09:00, 17:30).
      </p>

      {schedules.length > 0 && (
        <div className={styles.scheduleRows}>
          {schedules.map((row, index) => (
            <div key={index} className={styles.scheduleRow}>
              <select
                className={styles.select}
                value={row.day_of_week}
                disabled={disabled}
                onChange={(e) => updateRow(index, { day_of_week: Number(e.target.value) })}
              >
                {DAY_LABELS.map((label, day) => (
                  <option key={day} value={day}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className={`${styles.input} ${styles.mono}`}
                value={row.start_time}
                disabled={disabled}
                placeholder="09:00"
                inputMode="numeric"
                pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
                title="24-hour time (HH:MM)"
                aria-label="Start time"
                onChange={(e) => updateRow(index, { start_time: e.target.value })}
                onBlur={(e) => {
                  const normalized = normalizeScheduleTime(e.target.value);
                  if (normalized) updateRow(index, { start_time: normalized });
                }}
              />
              <input
                type="text"
                className={`${styles.input} ${styles.mono}`}
                value={row.end_time}
                disabled={disabled}
                placeholder="17:00"
                inputMode="numeric"
                pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
                title="24-hour time (HH:MM)"
                aria-label="End time"
                onChange={(e) => updateRow(index, { end_time: e.target.value })}
                onBlur={(e) => {
                  const normalized = normalizeScheduleTime(e.target.value);
                  if (normalized) updateRow(index, { end_time: normalized });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => removeRow(index)}
                aria-label="Remove schedule window"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={addRow}>
        Add window
      </Button>
    </div>
  );
}
