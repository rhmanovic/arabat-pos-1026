import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

type Direction = 'up' | 'start' | 'end' | 'fade';

/** Adds `visible` once the element scrolls into view (the original site's lazy-animate.js). */
export function useInView<T extends Element>(threshold = 0.1) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, visible]);
  return { ref, visible };
}

export function Reveal({
  children,
  direction = 'up',
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  direction?: Direction;
  delay?: number;
  className?: string;
  as?: ElementType;
}) {
  const { ref, visible } = useInView<HTMLElement>();
  const variant = direction === 'fade' ? '' : `reveal-${direction}`;
  return (
    <Tag
      ref={ref}
      className={`reveal ${variant} ${visible ? 'visible' : ''} ${className}`}
      style={delay ? ({ '--delay': `${delay}s` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
