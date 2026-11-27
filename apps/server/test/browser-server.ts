// SPDX-License-Identifier: AGPL-3.0-or-later
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";

export const webDir = fileURLToPath(new URL("../../app/dist", import.meta.url));

type Handler = (request: Request) => Response | Promise<Response>;

export async function withBrowserServer(
  run: (baseUrl: string, serve: (handler: Handler) => void) => Promise<void>,
) {
  await using server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a local TCP listener");
  await run(`http://127.0.0.1:${address.port}`, (handler) => {
    server.on("request", getRequestListener(handler));
  });
}
