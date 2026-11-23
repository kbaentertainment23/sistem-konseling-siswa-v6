import React, { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

interface SafeChartContainerProps {
  height: number;
  children: React.ReactElement;
}

/**
 * Prevents Recharts "width(0) and height(0) of chart should be greater than 0"
 * by measuring the container via ResizeObserver and only mounting ResponsiveContainer
 * once both width and height are strictly positive.
 */
export const SafeChartContainer: React.FC<SafeChartContainerProps> = ({ height, children }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const checkSize = () => {
      const rect = el.getBoundingClientRect();
      setReady(rect.width > 0 && rect.height > 0);
    };

    checkSize();

    if (typeof ResizeObserver === 'undefined') {
      setReady(true);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        setReady(width > 0 && h > 0);
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full min-w-0" style={{ height }}>
      {ready ? (
        <ResponsiveContainer width="100%" height={height} minWidth={0}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
};
