import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Шрифт кладём в сборку, а не надеемся на систему: сетка меряется по реальному
// начертанию, и фолбэк на чужой моноширинный увёл бы её на знак. Лигатуры
// JetBrains Mono гасятся в styles.css — `->` в терминале обязан быть двумя
// знаками, а не одним.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { App } from './App.tsx';
import { Adm } from './adm/Adm.tsx';
import { isAdmPath } from './ui/mode.ts';
import './styles.css';
import './adm/adm.css';

const root = document.getElementById('root');
if (!root) throw new Error('нет #root');

/*
 * Адрес выбирает, что вообще запускается. `/adm` — не режим игры, а инструмент
 * автора: у него нет ни сейва, ни рендерера, ни клавиш терминала, и городить
 * ему ветку внутри App значило бы навсегда связать их между собой.
 */
const adm = isAdmPath(location.pathname);

// У игры страница не прокручивается: экран — это окно, и терять из него нечего.
// Служебная карта, наоборот, длинная и листается как обычная страница, поэтому
// снимаем запрет — но только на своём адресе, классом на body.
if (adm) document.body.classList.add('adm-page');

createRoot(root).render(<StrictMode>{adm ? <Adm /> : <App />}</StrictMode>);
