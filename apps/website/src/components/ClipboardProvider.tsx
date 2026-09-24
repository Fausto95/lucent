import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { styles } from "./ClipboardProvider.stylex";

const ClipboardContext = createContext<{ copy: (text: string) => Promise<void> } | null>(null);

export function ClipboardProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied to clipboard");
    } catch {
      setMessage("Copy unavailable. Select and copy the code manually.");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3500);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ClipboardContext.Provider value={{ copy }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        {...stylex.props(styles.toast, Boolean(message) && styles.visibleToast)}
      >
        {message}
      </div>
    </ClipboardContext.Provider>
  );
}

export function useClipboard() {
  const context = useContext(ClipboardContext);
  if (!context) throw new Error("useClipboard requires ClipboardProvider");
  return context;
}
