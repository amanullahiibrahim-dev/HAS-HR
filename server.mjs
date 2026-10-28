import { createServer } from "node:http";
import { isIP } from "node:net";
import next from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const hostname = process.env.HAAZIR_BIND_HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const deviceIp = (process.env.ZKTECO_DEVICE_IP || "").replace(/^::ffff:/i, "");
const parts = hostname.split(".").map(Number);
const privateIPv4 = isIP(hostname) === 4 && (
  parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168)
  || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
);
const privateIPv6 = isIP(hostname) === 6 && (hostname === "::1" || /^(fc|fd|fe80:)/i.test(hostname));
if (!privateIPv4 && !privateIPv6) {
  throw new Error("HAAZIR_BIND_HOST must be one specific private or loopback IP address, not a wildcard or public address.");
}
const deviceParts = deviceIp.split(".").map(Number);
const privateDeviceIPv4 = isIP(deviceIp) === 4 && (
  deviceParts[0] === 10 || deviceParts[0] === 172 && deviceParts[1] >= 16 && deviceParts[1] <= 31
  || deviceParts[0] === 192 && deviceParts[1] === 168
);
const privateDeviceIPv6 = isIP(deviceIp) === 6 && /^(fc|fd)/i.test(deviceIp);
if (deviceIp && !privateDeviceIPv4 && !privateDeviceIPv6) {
  throw new Error("ZKTECO_DEVICE_IP must be one specific private LAN IP address.");
}

const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
createServer((request, response) => {
  if (request.url?.startsWith("/iclock/")) {
    const remoteIp = (request.socket.remoteAddress || "").replace(/^::ffff:/i, "");
    if (!deviceIp) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("Set ZKTECO_DEVICE_IP to the terminal's fixed LAN IP before enabling device traffic.");
      return;
    }
    if (remoteIp !== deviceIp) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Device IP not allowed.");
      return;
    }
  }
  void handle(request, response);
}).listen(port, hostname, () => {
  console.log(`Haazir App listening on http://${hostname}:${port}`);
});
