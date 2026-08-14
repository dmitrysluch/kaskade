import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Шрифт кладём в сборку, а не надеемся на систему: сетка меряется по реальному
// начертанию, и фолбэк на чужой моноширинный увёл бы её на знак. Лигатуры
// JetBrains Mono гасятся в styles.css — `->` в терминале обязан быть двумя
// знаками, а не одним.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('нет #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
