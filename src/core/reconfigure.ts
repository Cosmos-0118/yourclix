export function buildManualRecoveryDetails(
  title: string,
  steps: string[],
): string[] {
  return [title, ...steps.map((step, index) => `${index + 1}. ${step}`)];
}
