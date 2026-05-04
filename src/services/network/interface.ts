import { runCommand } from "../../core/exec.js";

/**
 * Default outbound interface from the routing table (matches Internet-bound traffic).
 */
export async function getDefaultRouteInterface(): Promise<string | null> {
  const result = await runCommand("/usr/sbin/route", ["-n", "get", "default"], {
    allowFailure: true,
  });

  if (result.code !== 0) {
    return null;
  }

  const match = result.stdout.match(/^\s*interface:\s*(\S+)/m);
  return match?.[1] ?? null;
}

/**
 * BSD interface names that correspond to Wi-Fi hardware (for soft power-cycle).
 */
export async function listWifiDeviceNames(): Promise<Set<string>> {
  const result = await runCommand("/usr/sbin/networksetup", [
    "-listallhardwareports",
  ], {
    allowFailure: true,
  });

  if (result.code !== 0) {
    return new Set();
  }

  const devices = new Set<string>();
  const blocks = result.stdout.trim().split(/\n(?=Hardware Port:)/);

  for (const block of blocks) {
    if (/Hardware Port:.*(Wi-Fi|AirPort|WLAN)/i.test(block)) {
      const deviceMatch = block.match(/^\s*Device:\s*(\S+)/m);
      if (deviceMatch) {
        devices.add(deviceMatch[1]);
      }
    }
  }

  return devices;
}

export function isSafeInterfaceName(name: string): boolean {
  return /^[a-z][a-z0-9]{0,14}$/i.test(name);
}
