// The pane-initialiser registry: each pane's script sets window.aiUiPanes[slug]; the shell calls it the first time
// that pane is shown.
interface Window {
  aiUiPanes: Record<string, () => void>;
}
