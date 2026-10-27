// The pane-initialiser registry: each pane's script sets window.aiUiPanes[slug]; the shell calls it the first time
// that pane is shown, or at load for a pane with markup in the top area.
interface Window {
  aiUiPanes: Record<string, () => void>;
  aiUiView: AiUiView | null;
}

// What the menus have picked: the module ("" when no pane offers modules), and the Details entry as its pane slug
// and item slug. The shell keeps it in window.aiUiView and sends it as the detail of an "ai-ui:view" event on
// document after every change.
interface AiUiView {
  module: string;
  pane: string;
  item: string;
}
