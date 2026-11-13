import type { LabelPaper, LabelTemplate, LabelTemplateLogo } from "@/types/label-templates";

export type LabelPreset = {
  id: string;
  name: string;
  paper: LabelPaper;
  html: string;
  css: string;
  logos?: LabelTemplateLogo[];
};

export type LabelPresetExport = {
  version: 1;
  template: Pick<
    LabelTemplate,
    "name" | "is_default" | "paper" | "html" | "css" | "logos" | "version"
  >;
};

export function wrapLabelHtml(bodyInner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
${bodyInner}
</body>
</html>`;
}

function clonePresetLogos(preset: LabelPreset): LabelTemplateLogo[] {
  return (preset.logos ?? []).map((logo) => ({ ...logo }));
}

export function toLabelTemplateExport(preset: LabelPreset): LabelPresetExport {
  return {
    version: 1,
    template: {
      name: preset.name,
      is_default: false,
      paper: { ...preset.paper },
      html: preset.html,
      css: preset.css,
      logos: clonePresetLogos(preset),
      version: 1,
    },
  };
}

export function presetToNewTemplate(preset: LabelPreset): LabelTemplate {
  return {
    id: crypto.randomUUID(),
    name: preset.name,
    is_default: false,
    paper: { ...preset.paper },
    html: preset.html,
    css: preset.css,
    logos: clonePresetLogos(preset),
    version: 1,
  };
}
