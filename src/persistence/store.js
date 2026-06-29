const KEY = "spacepoint.figure.v1";

export function saveFigure(model) {
  try {
    localStorage.setItem(KEY, JSON.stringify(model.serialize()));
    return true;
  } catch {
    return false;
  }
}

export function loadFigure(model) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    model.load(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}
