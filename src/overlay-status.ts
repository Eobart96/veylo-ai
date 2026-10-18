export interface OpenStatus { visible: boolean; ready: boolean; pinned: boolean; openError: string | null; editing?: boolean }
export function overlayStatus(view: OpenStatus | null, opening: boolean, error: string): string {
  if (opening) return "Открываем переводчик…";
  if (error || view?.openError) return "Не удалось открыть переводчик";
  if (!view?.visible) return "Оверлей скрыт";
  if (!view.ready) return "Окно открыто · переводчик загружается…";
  if (view.editing) return "Режим оверлея · фон затемнён";
  return view.pinned ? "Переводчик поверх игры · без затемнения" : "Переводчик открыт";
}
