// Mirrors the label color palette in desktop/src/main.tsx so new labels get the
// same auto-assigned colors on both platforms.
export const LABEL_COLORS = ['#7765da', '#249f84', '#dd7b3c', '#d75a75', '#198bc5', '#9f7a2c']

export function nextLabelColor(usedCount: number) {
  return LABEL_COLORS[usedCount % LABEL_COLORS.length]
}
