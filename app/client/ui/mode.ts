/**
 * Мобильная версия живёт на отдельном адресе, а не включается по ширине окна.
 *
 * Определять телефон по размеру экрана значит однажды подсунуть узкому окну
 * на ноутбуке интерфейс без клавиатуры — и наоборот. Адрес честнее: ссылку
 * открывают осознанно, её можно дать человеку, и она не меняется у него под
 * руками при повороте телефона.
 *
 * Игра при этом одна: `/m` — та же сборка и то же состояние, другой только
 * способ ввода. Сейв общий, потому что localStorage у адресов один.
 */

export const MOBILE_PATH = '/m';

export function isMobilePath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '');
  return clean === MOBILE_PATH || clean.startsWith(`${MOBILE_PATH}/`);
}

/**
 * Служебный просмотр графа. Тоже отдельный адрес и по той же причине: это не
 * режим игры, а инструмент автора, и попасть в него случайно нельзя.
 */
export const ADM_PATH = '/adm';

export function isAdmPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '');
  return clean === ADM_PATH || clean.startsWith(`${ADM_PATH}/`);
}

/** Сколько колонок держим на телефоне: ширина строки важнее числа строк. */
export const MOBILE_COLS = 40;

/** Подпись там, где на большом экране написано `Enter`. */
export const TAP_HINT = 'коснитесь';
