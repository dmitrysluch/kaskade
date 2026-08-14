/**
 * Звук как канал информации, а не фон ([[04-стиль-и-звук]]): у каждого эпизода свой
 * эмбиенс и своя клавиатура, и эмбиенс переезжает раньше текста — это главный
 * инструмент монтажа.
 *
 * Файлов пока нет. Отсутствие ресурса не должно ломать игру ни на секунду: не
 * загрузилось — играем в тишине и сообщаем об этом только в dev-консоли.
 */

const missing = new Set<string>();

function make(src: string, loop: boolean): HTMLAudioElement | null {
  if (typeof Audio === 'undefined' || missing.has(src)) return null;
  const audio = new Audio(src);
  audio.loop = loop;
  audio.addEventListener('error', () => {
    if (!missing.has(src)) {
      missing.add(src);
      if (import.meta.env?.DEV) console.info(`звук не найден: ${src} — играем в тишине`);
    }
  });
  return audio;
}

export class Ambience {
  private current: HTMLAudioElement | null = null;
  private src: string | null = null;

  play(src: string | null): void {
    if (src === this.src) return;
    this.stop();
    this.src = src;
    if (!src) return;
    this.current = make(src, true);
    this.current?.play().catch(() => {
      // Браузер не даёт играть до первого нажатия — попробуем на следующем.
      this.src = null;
    });
  }

  /** Звук уходит первым: ухо переезжает до глаза. */
  fadeOut(ms = 700): Promise<void> {
    const audio = this.current;
    this.current = null;
    this.src = null;
    if (!audio) return Promise.resolve();

    return new Promise((resolve) => {
      const step = 40;
      const delta = audio.volume / Math.max(1, ms / step);
      const timer = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - delta);
        if (audio.volume <= 0.01) {
          clearInterval(timer);
          audio.pause();
          resolve();
        }
      }, step);
    });
  }

  private stop(): void {
    this.current?.pause();
    this.current = null;
  }
}

export function keystroke(src: string | null): void {
  if (!src) return;
  const audio = make(src, false);
  if (!audio) return;
  audio.volume = 0.35;
  void audio.play().catch(() => {});
}
