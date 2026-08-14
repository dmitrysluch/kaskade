import { createServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';
import { buildBundle, type Bundle } from './bundle.ts';
import { CONTENT, ROOT } from './content/paths.ts';

/**
 * Один процесс на код и на контент.
 *
 * В dev Vite поднимается middleware'ом внутри Express, а не рядом: hot reload
 * компонента и hot reload заметки должны приходить в одну вкладку по одному адресу.
 * Это главная причина всей архитектуры — правишь заметку в Obsidian, вкладка
 * перерисовывается, — и разносить её по двум портам значит начать её ломать.
 */

const DEV = process.env.NODE_ENV !== 'production';
const PORT = Number(process.env.PORT ?? 5178);

const app = express();
const http = createServer(app);

let bundle: Bundle = buildBundle();
report(bundle);

app.get('/api/content', (_req, res) => {
  res.json(bundle);
});

if (DEV) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    // HMR ездит по тому же серверу: отдельный порт означал бы второй адрес,
    // который надо не занять кем-то ещё.
    server: { middlewareMode: true, hmr: { server: http } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(join(ROOT, 'dist')));
  app.get('*', (_req, res) => res.sendFile(join(ROOT, 'dist', 'index.html')));
}

// noServer, а не { server }: иначе ws зарубил бы чужие апгрейды, в том числе
// HMR-сокет Vite, который сидит на том же порту.
const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return;
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
});

function broadcast() {
  const message = JSON.stringify({ type: 'content', bundle });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function report(b: Bundle) {
  if (b.ok) {
    const nodes = Object.keys(b.content.nodes).length;
    console.log(`контент: ${Object.keys(b.content.docs).length} заметок, ${nodes} узлов`);
  } else {
    console.error('контент не собран:');
    for (const line of b.errors) console.error(`  ${line}`);
  }
}

// Watcher на весь vault: заметки, конфиги, портреты. Дебаунс маленький — Obsidian
// пишет файл в несколько приёмов, но ждать дольше значит терять то самое ощущение,
// ради которого всё и затевалось.
let timer: NodeJS.Timeout | null = null;
chokidar.watch(CONTENT, { ignoreInitial: true, ignored: /(^|[/\\])\../ }).on('all', () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    bundle = buildBundle();
    report(bundle);
    broadcast();
  }, 80);
});

http.listen(PORT, () => {
  console.log(`Принято к сведению — http://localhost:${PORT}`);
});
