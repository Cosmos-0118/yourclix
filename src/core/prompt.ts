import { ui } from "./ui.js";
export async function confirm(
  message: string,
  assumeYes = false,
): Promise<boolean> {
  return ui.confirm(message, assumeYes);
}
export async function askNumber(
  message: string,
  options: {
    defaultValue: number;
    min?: number;
    max?: number;
    assumeDefault?: boolean;
  },
): Promise<number> {
  return ui.number(message, options);
}
