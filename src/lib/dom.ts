/** Tiny DOM helpers — no framework, no dependencies. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** localStorage that never throws (strict private modes, disabled storage). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      /* best-effort persistence only — never break gameplay over storage */
      return false;
    }
  }
};

/** Parse a persisted JSON array without ever trusting its outer shape. */
export function parseStoredArray<T>(raw: string | null, accept: (value: unknown) => T | null, limit: number): T[] {
  const cap = Number.isSafeInteger(limit) ? Math.max(0, limit) : 0;
  if (!raw || cap === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: T[] = [];
    for (const value of parsed) {
      const accepted = accept(value);
      if (accepted !== null) out.push(accepted);
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.tabIndex = -1;
    ta.setAttribute("aria-hidden", "true");
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    try {
      previousFocus?.focus({ preventScroll: true });
    } catch {
      /* focus restoration is best-effort in detached or synthetic documents */
    }
    return ok;
  }
}
