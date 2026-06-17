import { useRef, type KeyboardEvent } from "react";
import styles from "./Auth.module.css";

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
};

export function VerificationCodeInput({ value, onChange, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").split("").slice(0, 6);

  const setAt = (index: number, char: string) => {
    const arr = value.padEnd(6, " ").split("").slice(0, 6);
    arr[index] = char;
    onChange(arr.join("").replace(/\D/g, "").slice(0, 6));
  };

  const handleChange = (index: number, raw: string) => {
    const d = raw.replace(/\D/g, "").slice(-1);
    if (!d) {
      setAt(index, " ");
      return;
    }
    setAt(index, d);
    if (index < 5) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index]?.trim() && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    const next = Math.min(pasted.length, 5);
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.codeRow} onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          className={styles.codeInput}
          value={d.trim()}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
