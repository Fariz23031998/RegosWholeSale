import { Trash2 } from "lucide-react";
import { Button } from "@/components/posui/Button";
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
      <p className={styles.hint}>No schedules = login allowed anytime. Add windows to restrict when this user can sign in.</p>

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
                type="time"
                className={styles.input}
                value={row.start_time}
                disabled={disabled}
                onChange={(e) => updateRow(index, { start_time: e.target.value })}
              />
              <input
                type="time"
                className={styles.input}
                value={row.end_time}
                disabled={disabled}
                onChange={(e) => updateRow(index, { end_time: e.target.value })}
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
