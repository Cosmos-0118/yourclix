import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { createNetworkLogger } from "./logger.js";
import { ensureSudoReady } from "./preflight.js";
import {
  getDefaultRouteInterface,
  listWifiDeviceNames,
} from "./interface.js";
import { runStepCommand, runStepScutilDhcpRefresh } from "./runner.js";
import { hasCriticalFailure, printNetworkSummary } from "./summary.js";
import type { NetworkLogger, NetworkStepResult } from "./types.js";

const TOTAL_STEPS = 7;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function softCycleWifi(
  iface: string,
  dryRun: boolean,
  logger: NetworkLogger,
): Promise<NetworkStepResult> {
  await logger.log(`[step:start] Wi-Fi soft-cycle :: ${iface}`);

  const off = await runStepCommand(
    "Wi-Fi power off",
    "/usr/sbin/networksetup",
    ["-setairportpower", iface, "off"],
    false,
    dryRun,
    logger,
  );

  if (off.status === "failed") {
    return {
      name: "Wi-Fi soft-cycle",
      critical: false,
      status: "failed",
      details: off.details,
    };
  }

  await delay(2000);

  const on = await runStepCommand(
    "Wi-Fi power on",
    "/usr/sbin/networksetup",
    ["-setairportpower", iface, "on"],
    false,
    dryRun,
    logger,
  );

  return {
    name: "Wi-Fi soft-cycle",
    critical: false,
    status: on.status === "success" ? "success" : "failed",
    details: [
      `Toggled ${iface} off, waited 2s, then on (networksetup -setairportpower).`,
      on.details[1] ?? on.details[0] ?? "",
    ].filter(Boolean),
  };
}

function skipStep(
  name: string,
  critical: boolean,
  reason: string,
): NetworkStepResult {
  return {
    name,
    critical,
    status: "skipped",
    details: [reason],
  };
}

export async function netFix(dryRun = false): Promise<void> {
  console.log(
    chalk.bold("Running deep network diagnostics and repair…"),
  );
  const logger = await createNetworkLogger("fix");
  const steps: NetworkStepResult[] = [];
  const progress = new CommandProgress("", TOTAL_STEPS);

  const precheck = await progress.interactiveStepWithStatus(
    "Checking sudo readiness",
    async () => ensureSudoReady(dryRun, logger),
  );
  steps.push(precheck);

  const canRepair =
    precheck.status === "success" || precheck.status === "skipped";

  let activeIface: string | null = null;
  let wifiDevices = new Set<string>();

  const discoverResult = await progress.stepNetwork(
    "Discovering active interface",
    async () => {
      activeIface = await getDefaultRouteInterface();
      wifiDevices = await listWifiDeviceNames();

      if (!activeIface) {
        return {
          name: "Active interface",
          critical: false,
          status: "skipped",
          details: [
            "Could not read default route (route -n get default). DHCP renewal and Wi-Fi targeting skipped.",
          ],
        };
      }

      const kind = wifiDevices.has(activeIface) ? "Wi-Fi" : "Ethernet / other";

      return {
        name: `Active interface: ${activeIface} (${kind})`,
        critical: false,
        status: "success",
        details: [`Default route is using interface ${activeIface}.`],
      };
    },
  );
  steps.push(discoverResult);

  steps.push(
    await progress.stepNetwork("Clearing ARP cache", async () => {
      if (!canRepair) {
        return skipStep(
          "ARP cache",
          true,
          "Skipped — sudo is not available (run sudo -v first, or use an interactive terminal).",
        );
      }
      return runStepCommand(
        "ARP cache",
        "sudo",
        ["-n", "/usr/sbin/arp", "-d", "-a"],
        true,
        dryRun,
        logger,
      );
    }),
  );

  steps.push(
    await progress.stepNetwork("Flushing DNS resolver cache", async () => {
      if (!canRepair) {
        return skipStep(
          "DNS cache",
          true,
          "Skipped — sudo is not available.",
        );
      }
      return runStepCommand(
        "DNS cache",
        "sudo",
        ["-n", "dscacheutil", "-flushcache"],
        true,
        dryRun,
        logger,
      );
    }),
  );

  steps.push(
    await progress.stepNetwork("Restarting mDNSResponder", async () => {
      if (!canRepair) {
        return skipStep(
          "mDNSResponder",
          true,
          "Skipped — sudo is not available.",
        );
      }
      return runStepCommand(
        "mDNSResponder",
        "sudo",
        ["-n", "killall", "-HUP", "mDNSResponder"],
        true,
        dryRun,
        logger,
      );
    }),
  );

  steps.push(
    await progress.stepNetwork("Renewing DHCP lease", async () => {
      if (!canRepair) {
        return skipStep(
          "DHCP lease renewal",
          false,
          "Skipped — sudo is not available.",
        );
      }
      if (!activeIface) {
        return skipStep(
          "DHCP lease renewal",
          false,
          "Skipped — no default interface from routing table.",
        );
      }
      return runStepScutilDhcpRefresh(activeIface, false, dryRun, logger);
    }),
  );

  steps.push(
    await progress.stepNetwork("Soft-cycling Wi-Fi interface", async () => {
      if (!activeIface || !wifiDevices.has(activeIface)) {
        return skipStep(
          "Wi-Fi soft-cycle",
          false,
          activeIface ?
            `Active interface (${activeIface}) is not Wi-Fi — skipping airport power toggle.`
          : "No default interface — skipping.",
        );
      }
      // Does not require sudo; still runs when other steps were skipped for missing sudo.
      return softCycleWifi(activeIface, dryRun, logger);
    }),
  );

  printNetworkSummary("your net fix", steps, logger.path);

  if (hasCriticalFailure(steps)) {
    throw new Error("One or more critical network fix steps failed.");
  }

  console.log(
    chalk.green("Network fix completed. ") +
      chalk.dim("Re-establishing connection…"),
  );
}
