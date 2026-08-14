import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// В dev Vite поднимается не сам, а как middleware внутри Express (app/server/index.ts):
// один порт и один процесс на код и на контент, чтобы hot reload заметки и hot reload
// компонента приходили в одну вкладку и не спорили за localhost.
export default defineConfig({
  root: r('app/client'),
  plugins: [react()],
  build: {
    outDir: r('dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
