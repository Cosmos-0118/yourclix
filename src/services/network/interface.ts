import { runCommand } from "../../core/exec.js";

export function isSafeInterfaceName(name: string): boolean {
  return /^[a-z][a-z0-9]{0,14}$/i.test(name);
}

/** Loopback and obvious non-data targets should not receive DHCP refresh. */
function isUsableDataInterface(name: string): boolean {
  if (!isSafeInterfaceName(name)) {
    return false;
  }
  if (/^lo\d*$/i.test(name)) {
    return false;
  }
  return true;
}

function parseInterfaceFromRouteText(text: string): string | null {
  const combined = text;
  const patterns = [
    /^\s*interface:\s*(\S+)/m,
    /\binterface:\s*(\S+)/i,
  ];
  for (const re of patterns) {
    const m = combined.match(re);
    if (m?.[1] && isUsableDataInterface(m[1])) {
      return m[1];
    }
  }
  return null;
}

async function interfaceFromRoute(args: string[]): Promise<string | null> {
  const result = await runCommand("/usr/sbin/route", args, {
    allowFailure: true,
  });
  if (result.code !== 0) {
    return null;
  }
  const text = `${result.stdout}\n${result.stderr}`;
  return parseInterfaceFromRouteText(text);
}

async function interfaceFromNetstatInet(): Promise<string | null> {
  const result = await runCommand("/usr/sbin/netstat", ["-rn", "-f", "inet"], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    return null;
  }

  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("default")) {
      continue;
    }
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length >= 4) {
      const candidate = parts[parts.length - 1];
      if (isUsableDataInterface(candidate)) {
        return candidate;
      }
    }
    const m = line.match(/^default\s+\S+\s+\S+\s+(\S+)/);
    if (m?.[1] && isUsableDataInterface(m[1])) {
      return m[1];
    }
  }

  return null;
}

/**
 * `scutil --nwi` lists interfaces with IPv4/DNS flags — useful when `route` output
 * is empty, sandboxed, or formatted unexpectedly.
 */
async function interfaceFromScutilNwi(): Promise<string | null> {
  const result = await runCommand("/usr/sbin/scutil", ["--nwi"], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    return null;
  }

  const enCandidates: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/^\s*(en\d+)\s*:/i);
    if (m?.[1] && isUsableDataInterface(m[1])) {
      enCandidates.push(m[1]);
    }
  }

  if (enCandidates.length === 0) {
    return null;
  }

  enCandidates.sort((a, b) => {
    const na = Number(a.replace(/^en/i, "") || "0");
    const nb = Number(b.replace(/^en/i, "") || "0");
    return na - nb;
  });

  return enCandidates[0] ?? null;
}

async function interfaceFromIpconfigProbe(): Promise<string | null> {
  for (const name of ["en0", "en1", "en2", "en3"]) {
    const r = await runCommand("/sbin/ipconfig", ["getifaddr", name], {
      allowFailure: true,
    });
    if (r.code === 0 && r.stdout.trim() && isUsableDataInterface(name)) {
      return name;
    }
  }
  return null;
}

async function interfaceFromWifiHardwarePorts(): Promise<string | null> {
  const wifi = await listWifiDeviceNames();
  for (const dev of wifi) {
    if (!isUsableDataInterface(dev)) {
      continue;
    }
    const r = await runCommand("/sbin/ipconfig", ["getifaddr", dev], {
      allowFailure: true,
    });
    if (r.code === 0 && r.stdout.trim()) {
      return dev;
    }
  }
  return null;
}

export interface ResolvedOutboundInterface {
  /** Primary interface for DHCP / Wi-Fi targeting; null if nothing reliable was found. */
  interface: string | null;
  /** How `interface` was chosen (for logs and UX). */
  source: string;
  /** Extra context for the operator. */
  hints: string[];
}

/**
 * Resolves the best outbound / LAN interface using several macOS-native sources.
 * Order: routing table → netstat → scutil NWI → ipconfig on en* → Wi-Fi hardware ports.
 */
export async function resolveOutboundInterface(): Promise<ResolvedOutboundInterface> {
  const hints: string[] = [];

  const routeArgLists: string[][] = [
    ["-n", "get", "default"],
    ["-n", "get", "0.0.0.0"],
    ["get", "default"],
  ];

  for (const args of routeArgLists) {
    const iface = await interfaceFromRoute(args);
    if (iface) {
      return {
        interface: iface,
        source: `route ${args.join(" ")}`,
        hints,
      };
    }
  }
  hints.push("route: no usable interface: from `route -n get default` / `0.0.0.0` / `get default`.");

  const fromNetstat = await interfaceFromNetstatInet();
  if (fromNetstat) {
    return {
      interface: fromNetstat,
      source: "netstat -rn -f inet (default row)",
      hints,
    };
  }
  hints.push("netstat: no IPv4 default row with interface column.");

  const fromScutil = await interfaceFromScutilNwi();
  if (fromScutil) {
    return {
      interface: fromScutil,
      source: "scutil --nwi (first en*)",
      hints,
    };
  }
  hints.push("scutil --nwi: no en* with IPv4 flags.");

  const fromIp = await interfaceFromIpconfigProbe();
  if (fromIp) {
    return {
      interface: fromIp,
      source: "ipconfig getifaddr (first en0–en3 with address)",
      hints,
    };
  }
  hints.push("ipconfig: no address on en0–en3.");

  const fromWifi = await interfaceFromWifiHardwarePorts();
  if (fromWifi) {
    return {
      interface: fromWifi,
      source: "networksetup -listallhardwareports + ipconfig",
      hints,
    };
  }
  hints.push("Wi-Fi hardware list: no device with an assigned IPv4 address.");

  return {
    interface: null,
    source: "none",
    hints,
  };
}

/**
 * Default outbound interface from the routing table (legacy single-source API).
 */
export async function getDefaultRouteInterface(): Promise<string | null> {
  const r = await resolveOutboundInterface();
  return r.interface;
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
    if (/Hardware Port:.*(Wi-Fi|AirPort|WLAN|Wireless)/i.test(block)) {
      const deviceMatch = block.match(/^\s*Device:\s*(\S+)/m);
      if (deviceMatch?.[1] && isSafeInterfaceName(deviceMatch[1])) {
        devices.add(deviceMatch[1]);
      }
    }
  }

  return devices;
}
