import { describe, expect, it } from "vitest";
import { LABEL_PRESETS } from "./presets";
import { presetToNewTemplate } from "./types";

describe("LABEL_PRESETS", () => {
  it("includes 58x30 REGOS v1 with logo, date footer, and safe barcode CSS", () => {
    const preset = LABEL_PRESETS.find((entry) => entry.id === "label-58x30-v1");
    expect(preset).toBeDefined();
    expect(preset?.paper).toEqual({ width_mm: 58, height_mm: 30 });
    expect(preset?.html).toContain('{{logoImg "REGOS"}}');
    expect(preset?.html).toContain("{{ date }}");
    expect(preset?.html).toContain("Цена за шт:");
    expect(preset?.css).toMatch(/\.label\s*\{[^}]*position:\s*relative/i);
    expect(preset?.css).toMatch(/\.name\s*\{[^}]*position:\s*absolute/i);
    expect(preset?.css).toMatch(/img\.barcode\s*\{[^}]*object-fit:\s*fill/i);
    expect(preset?.css).toMatch(/img\.barcode\s*\{[^}]*height:\s*9mm/i);
    expect(preset?.logos?.[0]?.name).toBe("REGOS");
    expect(preset?.logos?.[0]?.src.startsWith("data:image/png;base64,")).toBe(true);

    const template = presetToNewTemplate(preset!);
    expect(template.logos).toHaveLength(1);
    expect(template.logos[0]?.name).toBe("REGOS");
  });
});
