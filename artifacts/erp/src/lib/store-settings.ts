export const STORE_NAME_KEY = "midanic.erp.storeName";
export const DEFAULT_STORE_NAME = "Midanic";

export function getStoreName(): string {
  return localStorage.getItem(STORE_NAME_KEY) ?? DEFAULT_STORE_NAME;
}

export function setStoreName(name: string): void {
  localStorage.setItem(STORE_NAME_KEY, name.trim() || DEFAULT_STORE_NAME);
}
