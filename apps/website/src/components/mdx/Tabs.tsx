/**
 * Tabs, as the docs pages write them (<Tabs syncKey?><TabItem label>…): one
 * code block per tab, or a setup panel (Expo, bare React Native). Tabs with
 * the same syncKey switch together across the page and are remembered, like
 * Starlight's, whose markup and classes these keep so the code frames look
 * the same.
 */
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import type { TabItemProps } from "./TabItem";

interface Props {
  syncKey?: string;
  children: ReactNode;
}

const EVENT = "lucent-tabs-sync";

export default function Tabs({ syncKey, children }: Props) {
  const items = Children.toArray(children).filter((c): c is ReactElement<TabItemProps> =>
    isValidElement(c),
  );
  const labels = items.map((item) => item.props.label);
  const [selected, setSelected] = useState(0);
  const id = useId();
  const storageKey = syncKey ? `lucent-tabs-${syncKey}` : undefined;

  useEffect(() => {
    if (!storageKey) return;
    const apply = (label: string | null) => {
      const index = label === null ? -1 : labels.indexOf(label);
      if (index >= 0) setSelected(index);
    };
    apply(localStorage.getItem(storageKey));
    const onSync = (event: Event) => {
      const { key, label } = (event as CustomEvent<{ key: string; label: string }>).detail;
      if (key === storageKey) apply(label);
    };
    window.addEventListener(EVENT, onSync);
    return () => window.removeEventListener(EVENT, onSync);
  }, [storageKey, labels]);

  const select = (index: number) => {
    setSelected(index);
    if (!storageKey) return;
    localStorage.setItem(storageKey, labels[index]!);
    window.dispatchEvent(
      new CustomEvent(EVENT, { detail: { key: storageKey, label: labels[index] } }),
    );
  };

  return (
    <div className="lucent-tabs" data-sync-key={syncKey}>
      <div className="tablist-wrapper">
        <ul role="tablist">
          {items.map((item, index) => (
            <li key={item.props.label} className="tab" role="presentation">
              <a
                role="tab"
                href={`#${id}-${index}`}
                id={`${id}-tab-${index}`}
                aria-selected={index === selected}
                tabIndex={index === selected ? 0 : -1}
                onClick={(event) => {
                  event.preventDefault();
                  select(index);
                }}
              >
                {item.props.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      {items.map((item, index) => (
        <div
          key={item.props.label}
          id={`${id}-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          hidden={index !== selected}
        >
          {item.props.children}
        </div>
      ))}
    </div>
  );
}
