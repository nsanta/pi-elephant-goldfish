export function mount(target) {
  const el = document.querySelector(target);
  el.dataset.booted = "true";
  return el;
}

export const VERSION = "1.0.0";
