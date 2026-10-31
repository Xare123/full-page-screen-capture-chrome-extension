import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
createServer(async (req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const content = await readFile(
      new URL(
        req.url === "/dashboard"
          ? "./fixtures/dashboard.html"
          : req.url === "/email"
            ? "./fixtures/email.html"
            : "./fixtures/page.html",
        import.meta.url,
      ),
    );
    res.writeHead(200, { "content-type": "text/html" });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(4173, "127.0.0.1");
