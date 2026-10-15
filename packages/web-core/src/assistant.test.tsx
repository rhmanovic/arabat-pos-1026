import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAssistantThread } from './assistant.js';

describe('useAssistantThread', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps the thread, its id and the open state across a remount (reload), and drops them on clear', () => {
    const first = renderHook(() => useAssistantThread('pos'));
    const id = first.result.current.conversationId;
    act(() => {
      first.result.current.setThread([{ role: 'user', content: 'كم سعر الحليب؟' }]);
      first.result.current.setOpen(true);
    });
    first.unmount();

    const second = renderHook(() => useAssistantThread('pos'));
    expect(second.result.current.conversationId).toBe(id);
    expect(second.result.current.thread).toEqual([{ role: 'user', content: 'كم سعر الحليب؟' }]);
    expect(second.result.current.open).toBe(true);
    // Another surface has its own thread.
    expect(renderHook(() => useAssistantThread('manager')).result.current.thread).toEqual([]);

    act(() => second.result.current.setThread([]));
    expect(second.result.current.conversationId).not.toBe(id);
    act(() => second.result.current.setOpen(false));
    expect(sessionStorage.getItem('arabat.assistant.pos')).toBeNull();
  });

  it('reopens a past conversation under its own id', () => {
    const { result } = renderHook(() => useAssistantThread('manager'));
    act(() =>
      result.current.load('0190a000-0000-7000-8000-0000000000c1', [{ role: 'user', content: 'q' }]),
    );
    expect(result.current.conversationId).toBe('0190a000-0000-7000-8000-0000000000c1');
    expect(result.current.thread).toHaveLength(1);
  });
});
