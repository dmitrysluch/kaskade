import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run smoke` — поднимает сервер на свободном порту, дёргает его и гасит.
 * Проверяет ровно то, чего не видно из юнит-тестов: что оболочка вообще отдаётся
 * и что контент доезжает до клиента одним куском.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROD = process.env.MODE === 'production';
// Разные порты у режимов: иначе прогон рискует опросить сервер, оставшийся
// от предыдущего, и отчитаться о чужой работе как о своей.
const PORT = String(process.env.PORT ?? (PROD ? 5180 : 5179));

const server = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['app/server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT, NODE_ENV: PROD ? 'production' : 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
  // Своя группа процессов: гасим её целиком, чтобы сервер не пережил прогон.
  detached: true,
});

let exited = false;
server.on('exit', () => (exited = true));

let log = '';
server.stdout.on('data', (b: Buffer) => (log += b.toString()));
server.stderr.on('data', (b: Buffer) => (log += b.toString()));

async function waitFor(url: string, tries = 40): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    if (exited) throw new Error(`сервер упал, не начав работать:\n${log}`);
    try {
      return await fetch(url);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`сервер не поднялся за ${tries * 250} мс:\n${log}`);
}

/**
 * Открывает сокет, трогает файл контента и ждёт, что сервер сам расскажет о правке.
 *
 * Трогаем `game.yaml`, а не заметку, по двум причинам: заметки приезжают из Obsidian
 * и `npm run sync` показал бы такую правку как изменение, а возвращать mtime назад
 * нельзя — иногда это гасит само событие, за которым мы сюда и пришли.
 */
async function notifiesOnEdit(): Promise<boolean> {
  const { WebSocket } = await import('ws');
  const file = join(ROOT, 'content/game.yaml');

  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${PORT}/ws`);
    // С запасом: watcher дебаунсит правку, а под нагрузкой (рядом идут тесты)
    // событие доезжает не мгновенно. Пять секунд давали ложную тревогу.
    const timer = setTimeout(() => {
      socket.close();
      resolve(false);
    }, 15000);

    // Перезапись тем же содержимым: mtime меняется, текст — нет.
    socket.on('open', () => writeFileSync(file, readFileSync(file, 'utf8')));
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; bundle: { ok: boolean } };
      if (message.type !== 'content') return;
      clearTimeout(timer);
      socket.close();
      resolve(message.bundle.ok);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

const problems: string[] = [];
function check(ok: boolean, what: string) {
  console.log(`${ok ? '  ок  ' : ' ПЛОХО'} ${what}`);
  if (!ok) problems.push(what);
}

try {
  const api = await waitFor(`http://localhost:${PORT}/api/content`);
  const bundle = (await api.json()) as { ok: boolean; content?: { title: string; nodes: Record<string, unknown> } };

  check(bundle.ok, 'контент собран и отдан по /api/content');
  check(bundle.content?.title === 'Принято к сведению', 'заголовок игры на месте');
  check(Object.keys(bundle.content?.nodes ?? {}).length > 40, 'узлы доехали целиком');

  const page = await fetch(`http://localhost:${PORT}/`);
  const html = await page.text();
  check(page.ok && html.includes('<div id="root">'), 'оболочка отдаётся');
  const clientOk = html.includes(PROD ? '/assets/' : 'main.tsx');
  check(clientOk, 'клиент подключён');
  if (!clientOk) console.error(`\n--- отдано ---\n${html.slice(0, 400)}\n---`);

  // Главное обещание архитектуры: правишь заметку — вкладка узнаёт об этом сама.
  check(await notifiesOnEdit(), 'правка заметки прилетает по ws');
} finally {
  if (!exited && server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}

if (problems.length > 0) {
  console.error(`\nне сошлось: ${problems.length}`);
  process.exit(1);
}
console.log('\nсмоук пройден');
