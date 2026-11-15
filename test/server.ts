import { createServer, IncomingHttpHeaders, Server } from "http";
import { AddressInfo } from "net";

export interface TestServer {
  url: string;
  /** Request headers seen per path, most recent last. */
  requests: { path: string; headers: IncomingHttpHeaders }[];
  close(): Promise<void>;
}

const PAGE = (body: string, style = "") =>
  `<!doctype html><html><head><style>
    html, body { margin: 0; background: #fff; }
    @media (prefers-color-scheme: dark) { body { background: #000; } }
    ${style}
  </style></head><body>${body}</body></html>`;

const ROUTES: Record<string, () => string> = {
  "/": () =>
    PAGE(
      `<div id="banner" style="height:40px;background:red">Cookies</div>
       <div id="card" style="width:120px;height:80px;background:blue"></div>`,
    ),
  "/docs/intro.html": () => PAGE("<h1>Intro</h1>"),
  "/late.html": () =>
    PAGE(`<script>
      setTimeout(() => {
        const el = document.createElement("div");
        el.id = "ready";
        el.textContent = "ready";
        document.body.appendChild(el);
      }, 200);
    </script>`),
};

const AUTH = "Basic " + Buffer.from("user:pass").toString("base64");

/** Starts a local HTTP server with a few fixed pages for browser tests. */
export async function startServer(): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    requests.push({ path, headers: req.headers });
    if (path === "/private.html") {
      if (req.headers.authorization !== AUTH) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
        res.end("unauthorized");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE("<p>secret</p>"));
      return;
    }
    const route = ROUTES[path];
    if (route === undefined) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(PAGE("<p>not found</p>"));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(route());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** Reads the pixel size from a PNG file's IHDR chunk. */
export function pngSize(data: Buffer): { width: number; height: number } {
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
