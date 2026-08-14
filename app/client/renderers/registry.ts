import type { ComponentType, ReactNode } from 'react';
import { Academic } from './academic.tsx';
import type { RendererDef } from '../../shared/types.ts';

export interface RendererProps {
  def: RendererDef;
  children: ReactNode;
}

/**
 * Рендереры регистрируются по имени из `game.yaml`. Новый стиль = запись в
 * `renderers` плюс компонент с тем же именем; прологу нужен ровно один.
 */
export const RENDERERS: Record<string, ComponentType<RendererProps>> = {
  academic: Academic,
};

export function rendererFor(name: string): ComponentType<RendererProps> {
  const found = RENDERERS[name];
  if (!found) throw new Error(`нет рендерера "${name}" — добавить компонент и зарегистрировать`);
  return found;
}
