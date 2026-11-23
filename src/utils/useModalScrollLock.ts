import { useEffect } from 'react';

/**
 * Locks background scrolling (both the main app scroll container and document root)
 * while an overlay modal is open, without disturbing sticky/pinned sidebar or header layout.
 */
export function useModalScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const mainScroller = document.querySelector<HTMLElement>('[data-scroll-container="main"]');
    const prevMainOverflowY = mainScroller ? mainScroller.style.overflowY : '';
    const prevMainOverscroll = mainScroller ? mainScroller.style.overscrollBehavior : '';
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    if (mainScroller) {
      mainScroller.style.overflowY = 'hidden';
      mainScroller.style.overscrollBehavior = 'none';
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      if (mainScroller) {
        mainScroller.style.overflowY = prevMainOverflowY;
        mainScroller.style.overscrollBehavior = prevMainOverscroll;
      }
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
    };
  }, [locked]);
}
